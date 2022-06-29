"""Main Application Module for the RESTful API.

   Handles the routing of requests for User Account, Player, Transaction and
   Depth data.

   Data is always returned as JSON objects.
"""

import webapp2
import datetime
from google.appengine.ext import ndb
from google.appengine.api import urlfetch
from google.appengine.api import memcache

import os
import jinja2
import json

import datetime

from py.transaction import *
from py.player import *
from py.depth import *

JINJA_ENVIRONMENT = jinja2.Environment(
   loader=jinja2.FileSystemLoader(os.path.dirname(__file__)),
   extensions=['jinja2.ext.autoescape'],
   autoescape=True)

class AccountHandler(UserHandler):
   """Manages unique authenticated user accounts, including the creation and
      updating of information.
   """
   def get(self):
      """Logs the user out of their session."""
      parameters = {}
      parameters['logout'] = self.request.get('logout')
      if parameters['logout']:
         self.logout()

   def post(self):
      """Handles account creation (signup), login and update."""
      parameters = json.loads(self.request.body)
      if 'request' in parameters:
         if 'signup' in parameters:
            self.signup(parameters['request'])
         elif 'login' in parameters:
            self.login(parameters['request'])
         elif 'reset' in parameters:
            self.reset(parameters['request'])

   def signup(self, request):
      """Creates a new account and sets the session for that account.

      Args:
         request: Request data including an email, password, and name.
      """
      # Get user data from request
      req = json.loads(request)
      email = req['email']
      password = req['password']
      password_again = req['password_again']
      name = req['name']

      # Create user, auth_id is a unique identifier and will take format "auth:example@gmail.com"
      # As the User model is "expando" (who comes up with these names?) we can dynamically add fields at creation
      # Final note, passing a raw password as param password_raw hashes it automatically.
      success, info = self.auth.store.user_model.create_user(
         "auth:"+email, unique_properties=['email'],
         email = email, password_raw = password, nickname = name,
         cash=50000)
      if success:
         # Set session cookie to reflect new user
         self.auth.set_session(self.auth.store.user_to_dict(info), remember=True)
      else:
         if 'email' in info:
            self.response.set_status(403, message = "Signup failed, that email already exists in system")
         else:
            # Something strange in the neighbourhood
            self.response.set_status(403, message = "Something went wrong with account creation, possible duplicate: ".join(info))

   def login(self, request):
      """Authenticates an existing account.

      Args:
         request: Request data including an email and password.

      Raises:
         InvalidAuthIdError: If no user exists for that email.
         InvalidPasswordError: If the password given does not match that stored
            with the account details.
      """
      req = json.loads(request)
      email = req['email']
      password = req['password']
      try:
         self.auth.get_user_by_password("auth:"+email, password)
      except (auth.InvalidAuthIdError, auth.InvalidPasswordError):
         self.response.set_status(403)

   @login_required
   def logout(self):
      """Unsets the session cookie."""
      self.auth.unset_session()
      self.redirect('/#/welcome')

   @login_required
   def reset(self, request):
      """Updates the password for the account.

      Args:
         request: Request data including an email, new password and old password.
      """
      req = json.loads(request)
      email = req['email']
      password = req['password']
      old_pass = req['old_pass']

      success, error = self.user_model.update_password(old_pass, password)
      if success:
         self.user_model.put()
         self.response.set_status(200)
      else:
         self.response.set_status(403)

class MainPage(UserHandler):
   """MainPage class loads the index.html file (the basis of the Single Page
      Application).
   """
   def get(self):
      template = JINJA_ENVIRONMENT.get_template('app/index.html')
      self.response.write(template.render())

class OrderHandler(UserHandler):
   """Handles actions related to transactions, including creating, deleting,
      updating, and executing pending.

   Also handles caching of stock data to optimise the website performance.
   """

   def get(self):
      """Workaround for cronjob to initiate a put request."""
      if (self.request.get('execution')):
         self.put()

   def post(self):
      """Creates a new Transaction from an order.

      The request body contains the information for creating the Transaction.
      """
      # Load the transaction data from the request body into a dictionary.
      data = json.loads(self.request.body)
      if ('order' in data):
         order = json.loads(data['order'])
         if (order and Transaction.is_valid(order)):
            player = Player.query(Player.email==order['email']).get()
            order['cashHistory'] = 0;
            transaction = Transaction.new(order)
            player.add_transaction(transaction)
            transaction.cashHistory = player.cash;
            transaction.put();
         else:
            # Data is invalid.
            self.response.set_status(400)

   def delete(self):
      """Cancels a transaction corresponding to the transaction key parsed in
         through the request.
      """
      key = self.request.get('key')
      if (key):
         # Get the key and the current user
         transaction_key = ndb.Key(urlsafe=key)
         transaction = transaction_key.get()
         # Only delete pending orders
         if (transaction.executed == False):
            cur_user = self.user_model
            try:
               # Delete the transaction from the user's records as well
               # as from transaction records
               cur_user.delete_transaction(transaction_key)
               Transaction.delete(transaction_key)
               self.response.set_status(200)
            except ValueError, AttributeError:
               # Invalid key
               self.response.set_status(500)
         else:
            self.response.set_status(500)

   def put(self):
      """Compares the current bid/ask of the corresponding stock to all pending
         orders and executes if the normal order execution conditions are
         satisfied.
      """
      # We only want to trade on weekdays, so return if Saturday or Sunday
      # For speed when daylight savings occurs does not need to be considered
      # because the cron job only runs between 10am and 4pm, and the hour discrepancy
      # of daylight savings will only affect 11pm - 1am (i.e. when this function won't be run)
      # 11 hours = max difference between UTC and AEDT
      dow = (datetime.datetime.today() + timedelta(hours=11)).weekday()
      if (dow == 5 or dow == 6):
         return

      # Cache latest share data
      share_dict = self.get_share_data()
      memcache.set('share_data', share_dict)

      # Creates a ndb query to get the stocks that are not executed, sorted
      # in order of stock code.
      order_stocks = Transaction.query(projection=["stock"], distinct=True).filter(Transaction.executed == False).order(Transaction.stock)
      for order_stock in order_stocks:
         # For each stock code get the bid and ask
         bid = float(share_dict[str(order_stock.stock)]['Bid'])
         ask = float(share_dict[str(order_stock.stock)]['Ask'])
         last_price = float(share_dict[str(order_stock.stock)]['LastTradePriceOnly'])

         # Get all the pending orders of that stock code
         pending_orders = Transaction.query(ndb.AND(Transaction.executed == False, Transaction.stock == order_stock.stock))
         for order in pending_orders:
            if (order.subtype == 'market'):
               # If the order is a market transaction, it executes at current bid/ask and
               # A) refunds/charges the difference in money for a buy
               # B) updates cash for a sell
               player = Player.query(Player.transactions == order.key).get()
               if (order.type == 'buy'):
                  # Refunds money if order.price >= ask, otherwise charges extra if
                  # order.price <= ask. Order will not be executed if it puts the player in debt
                  difference = order.price - ask
                  if (player.cash + difference >= 0):
                     order.price = ask
                     player.update_cash(difference, order)
                     order.timestamp = datetime.datetime.now()
                     order.executed = True
                     order.put()
               elif (order.type == 'sell'):
                  # Sells at the bid and updates the cash based off that price
                  order.price = bid
                  player.update_cash(order.price, order)
                  order.timestamp = datetime.datetime.now()
                  order.executed = True
                  order.put()
            elif (order.subtype == 'limit') and \
               ((order.type == 'buy' and order.price >= ask) or (order.type == 'sell' and order.price <= bid)):
               # If the order is a limit transaction it will get executed only
               # when certain conditions are met.
               player = Player.query(Player.transactions == order.key).get()
               if (order.type == 'buy' and order.price >= ask):
                  # The order will get executed at the lowest ask
                  # and you will be refunded the difference
                  difference = order.price - ask
                  order.price = ask
                  player.update_cash(difference, order)
               if (order.type == 'sell' and order.price <= bid):
                  # The order will get executed at the largest bid
                  # and your cash will get updated accordingly
                  order.price = bid
                  player.update_cash(order.price, order)
               order.timestamp = datetime.datetime.now()
               order.executed = True
               order.put()
            elif (order.subtype == 'stop') and \
               ((order.type == 'buy' and last_price >= order.price) or (order.type == 'sell' and last_price <= order.price)):
               # A stop buy order is executed when the price goes above your price
               # You only need to execute the order
               # A stop sell order is executed when the price goes below your price
               # You want to update the cash and execute the order
               if (order.type == 'sell' and last_price <= order.price):
                  player = Player.query(Player.transactions == order.key).get()
                  player.update_cash(order.price, order)
               order.timestamp = datetime.datetime.now()
               order.executed = True
               order.put()

   def get_share_data(self):
      """Places the most recent Bid, Ask and LastTradePriceOnly in the Cache
         to speed up the website.
      """
      # Open the list of 200 shares
      with open('app/static/codes200A.json') as share_data_list:
         share_list = json.load(share_data_list)

      # Grab the first hundred shares and second hundred shares separately
      # in order to take into account the maximum length of urls
      share_dict_1 = {}
      share_dict_2 = {}
      i = 0
      for share in share_list:
         # Handle max length of url
         if i < 100:
            share_dict_1[str(share['code'])] = 0
         if i >= 100:
            share_dict_2[str(share['code'])] = 0
         i+=1

      data_1 = self.grab_yahoo_data(share_dict_1)
      data_2 = self.grab_yahoo_data(share_dict_2)

      # Merge the two dicts into share_dict
      share_dict = {}
      i = 0
      for share in share_dict_1.keys():
         share_dict[str(share)] = data_1['query']['results']['quote'][i]
         i += 1
      i = 0
      for share in share_dict_2.keys():
         share_dict[str(share)] = data_2['query']['results']['quote'][i]
         i += 1

      return share_dict

   def grab_yahoo_data(self, share_dict):
      """Gets the LastTradePriceOnly for a dictionary of stocks from the Yahoo
         Finance API.

      Args:
         share_dict: A dictionary of shares to fetch data for.

      Returns:
         A JSON object with the price data for each stock in the dictionary.
      """
      yahoo_url = "https://query.yahooapis.com/v1/public/yql?q=select%20Ask%2C%20Bid%2C%20LastTradePriceOnly%20from%20yahoo.finance.quotes%20where%20symbol%20IN%20(" + ",%20".join('"' + key + '"' for key in share_dict.keys()) + ")%20&format=json&diagnostics=false&env=store%3A%2F%2Fdatatables.org%2Falltableswithkeys&callback="
      response = urlfetch.fetch(yahoo_url)
      data = json.loads(response.content)
      return data

class StatusHandler(UserHandler):
   """Handles all requests for game information relating to a Player."""

   def get(self):
      """Get the requested information for the current player.

      Takes a number of parameters in the HTTP request that specify which
      information to return.
      """
      # Get the parameters to return
      parameters = {}
      parameters['email'] = self.request.get('email')
      parameters['cash'] = self.request.get('cash')
      parameters['nickname'] = self.request.get('nickname')
      parameters['pending'] = self.request.get('pending')
      parameters['holdings'] = self.request.get('holdings')
      parameters['share'] = self.request.get('share')
      parameters['sellable_shares'] = self.request.get('sellable_shares')
      parameters['history'] = self.request.get('history')
      parameters['birthday'] = self.request.get('birthday')
      parameters['codes'] = self.request.get('codes')
      parameters['leaderboard'] = self.request.get('leaderboard')

      cur_user = self.user_model
      if cur_user:
         user_info = {}
         if parameters['email']:
            user_info['email'] = cur_user.email
         if parameters['cash']:
            user_info['cash'] = cur_user.cash
         if parameters['nickname']:
            user_info['nickname'] = cur_user.nickname
         if parameters['pending']:
            user_info['pending'] = cur_user.get_transactions(executed=False)
            user_info['pendingVal'] = cur_user.get_pending_shares_value();
         if parameters['holdings'] or parameters['share']:
            shares = cur_user.get_shares()
            if parameters['holdings']:
               user_info['holdings'] = shares
            if parameters['share']:
               user_info['share'] = cur_user.get_total_shares_value(shares)
         if parameters['sellable_shares']:
            user_info['sellable_shares'] = cur_user.get_sellable_shares()
         if parameters['history']:
            user_info['history'] = cur_user.get_transactions(executed=True)
         if parameters['birthday']:
            user_info['birthday'] = str(cur_user.birthday)[0:10]
         if parameters['codes']:
            user_info['codes'] = cur_user.get_stock_code_and_dates()
         if parameters['leaderboard']:
            user_info['leaderboard'] = Player.get_leaderboard();

         self.response.write(json.dumps(user_info))
      else:
         self.response.set_status(404)

class DepthHandler(webapp2.RequestHandler):
   """Handles requests relating to the market depth of stocks."""
   def post(self):
      """Creates (or updates) the market depth for the given stock.

      Returns:
         The updated depth data.
      """
      request = json.loads(self.request.body)

      # Ensure the request data is in the correct format
      if (request and request['max_bid'] > 0
         and request['min_ask'] > 0
         and request['avg_volume'] > 0):

         # Generate the market depth
         depth = Depth.get(request)
         depth_data = {
            'bids' : depth.bids,
            'asks' : depth.asks
         }
         # Write the depth to the page
         self.response.write(json.dumps(depth_data))
      else:
         # Send a message indicating client data is in the wrong format
         self.response.set_status(400)

config = {}
config['webapp2_extras.sessions'] = {
   # Randomly generated for cookie signing
   'secret_key': '570656f7c98dd3fb00a393895166367a',
}
config['webapp2_extras.auth'] = {
   'user_model': Player,
}

app = webapp2.WSGIApplication([
   ('/account', AccountHandler),
   ('/order', OrderHandler),
   ('/depth', DepthHandler),
   ('/user', StatusHandler),
   (r'/.*', MainPage)
], config=config, debug=True)
