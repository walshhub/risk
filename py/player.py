"""Player Model Class

   This module contains the model for players and all related functions.
"""

import webapp2
import json
from py.transaction import *
from google.appengine.ext import ndb
from google.appengine.api import memcache
from google.appengine.api import urlfetch
import webapp2_extras.appengine.auth.models as auth_models
from webapp2_extras import auth, sessions, security
from datetime import timedelta

class Player(auth_models.User):
   """Stores game related information for the player.

   Attributes:
      email: The player's email, used to uniquely identify.
      cash: The amount of cash currently held. Initially this is $50,000.
      transactions: A list of Transaction objects representing the player's
         historical transactions.
      birthday: The time the player was created in the system.
   """
   email = ndb.StringProperty(required=True)
   cash = ndb.FloatProperty(required=True)
   transactions = ndb.KeyProperty(kind='Transaction', repeated=True)
   birthday = ndb.DateTimeProperty(auto_now_add=True, required=True)

   @classmethod
   def get_leaderboard(cls):
      """Gets information on all players for display on the leaderboard.

      Returns:
         A dictionary mapping a players email to their game information.
      """
      leaderboard = {}
      players = Player.query()
      if players:
         for player in players:
            # find the total share values of a player
            playerShares = player.get_shares()
            if (len(playerShares) > 0):
               shares = player.get_total_shares_value(playerShares)
            else:
               shares = 0
            if player.get_transactions(executed=False):
               pending = player.get_pending_shares_value()
            else:
               pending = 0
            total = player.cash + shares + pending
            leaderboard[player.email] = [player.cash, player.nickname, str(player.birthday.isoformat()), shares, pending, total]
      return leaderboard

   def add_transaction(self, transaction):
      """Adds a transaction to the transactions list attribute for this player.

      Args:
         transaction: A Transaction model instance.
      """
      self.transactions.append(transaction.key)
      # Takes out the transaction fee for any transaction
      self.cash = self.cash - transaction.fee
      # Updates the cash immediately for the buy order (any changes in the price
      # are handled by a refund process later)
      if (transaction.type == 'buy' and transaction.executed == False):
         self.update_cash(-transaction.price, transaction)
      self.put()

   def update_cash(self, unit_price, transaction):
      """Updates cash based off the quantity multiplied by the unit price

      NOTE: If the aim is to subtract money, unit price should be negative while
      adding money uses a positive unit price

      Args:
         unit_price: The signed price of the unit (negative = reduces cash,
            positive = adds cash).
         transaction: The relevant transaction involved in the cash update.
      """
      if (transaction.type == 'buy' or transaction.type == 'sell'):
         self.cash = self.cash + transaction.quantity * unit_price
         transaction.cashHistory = self.cash
         transaction.put()
      self.put()

   def update_password(self, old_pass, new_pass):
      """Provide hash function allowing user to update their password.

      Args:
         old_pass: The old password to be replaced.
         new_pass: The new password.

      Returns:
         A tuple where first element is true if password creation successful,
         false otherwise, and second element is a string with reasons for
         failure or None if successful.
      """
      if not security.check_password_hash(old_pass, self.password):
         return False, "Old password incorrect"
      pass_hash = security.generate_password_hash(new_pass)
      self.password = pass_hash
      return security.check_password_hash(new_pass, self.password), None

   def get_shares(self):
      """Gets the amount of each share held by the player.

      Returns:
         A dict containing a dict for each stock code. The inner dict contains
         the quantity of the stock owned (as a dict so that it is more easily
         extensible).
      """
      shares = {}
      # Counts the number of stocks that have been cumulated for the cost in
      # order to calculate the average at the end.
      count = {}

      # Go through the executed transactions and calculate the total
      # number of shares held
      for transaction_key in self.transactions:
         transaction = transaction_key.get()
         if transaction.stock not in shares.keys():
            shares[transaction.stock] = {'quantity': 0, 'purchase_price': 0}
            count[transaction.stock] = 0
         if (transaction.type == 'buy' and transaction.executed == True):
            shares[transaction.stock]['quantity'] += transaction.quantity
            shares[transaction.stock]['purchase_price'] += transaction.quantity * transaction.price
            count[transaction.stock] += transaction.quantity
         elif (transaction.type == 'sell' and transaction.executed == True):
            shares[transaction.stock]['quantity'] -= transaction.quantity

      for stock in shares.keys():
         if count[stock] > 0:
            shares[stock]['purchase_price'] = shares[stock]['purchase_price'] / count[stock]
      # Remove all stocks with 0 quantity held
      shares = {stock: data for (stock, data) in shares.iteritems() if data['quantity'] > 0}
      return shares

   def get_stock_code_and_dates(self):
      """Gets a dictionary of all stock codes and dates for display on a chart.

      Returns:
         A dictionary mapping stock codes to dates.
      """
      codes = {}
      stockQuantity = {}
      for transaction_key in self.transactions:
         transaction = transaction_key.get()
         if (transaction.type == 'buy' and transaction.executed == True):
            # Checks if same stock was bought previously
            if (transaction.stock in codes):
               stockQuantity[transaction.stock] += transaction.quantity
            else:
               codes[transaction.stock] = str(transaction.timestamp)[:10]
               stockQuantity[transaction.stock] = transaction.quantity
         # When all the stock holding from a company is sold
         elif (transaction.type == 'sell' and transaction.executed == True and transaction.quantity == stockQuantity[transaction.stock]):
            codes[transaction.stock] = codes[transaction.stock] + "~" + str(transaction.timestamp)[:10]
      return codes

   def get_transactions(self, executed):
      """Gets a dictionary indexed by timestamp and containing information
         about all transactions for the player.

      NOTE: Timestamp assumed to be unique (used instead of key for sorting purposes)

      Args:
         executed: The execution status of the transaction (true or false).

      Returns:
         A dictionary mapping timestamps to transaction information.
      """
      # Create an empty dict
      shares = {}
      # Dict indexed by stock code which contains the average purchase price and number of
      # prices used in average.
      purchase_prices = {}

      if (self.transactions):
         transactions = Transaction.query(ndb.AND
         (Transaction.executed == executed, Transaction.key.IN(self.transactions)))
         for transaction in transactions:
            temp = {}
            temp["stock"] = transaction.stock
            temp["type"] = transaction.type
            temp["subtype"] = transaction.subtype
            temp["quantity"] = transaction.quantity
            temp["price"] = transaction.price
            # Adjust UTC time to AEDST GMT +11:00 for Sydney, where the market is.
            transaction.timestamp += timedelta(hours=11)
            temp["timestamp"] = str(transaction.timestamp.isoformat());
            temp["cashHistory"] = transaction.cashHistory
            temp["key"] = transaction.key.urlsafe()
            if (executed):
               if (temp["type"] == "buy"):
                  if temp["stock"] not in purchase_prices.keys():
                     purchase_prices[temp["stock"]] = {'average': temp["price"], 'number': 1}
                  else:
                     a = purchase_prices[temp["stock"]]['average']
                     n = purchase_prices[temp["stock"]]['number']
                     a_2 = (a * n + temp["price"]) / (n + 1)
                     purchase_prices[temp["stock"]]['average'] = a_2
                     purchase_prices[temp["stock"]]['number'] += 1
               if (temp["type"] == "sell"):
                  # Can't have sold without buying first.
                  temp["net_gain"] = temp["quantity"] * (temp["price"] - purchase_prices[temp["stock"]]['average'])
            shares[str(transaction.timestamp)] = temp
      return shares

   def get_sellable_shares(self):
      """Gets the current amount of shares owned by a player, adjusted to
         account for pending sales.

      Used to ensure a player cannot place orders to sell more of a stock than they own.

      Returns:
         A dictionary mapping stock codes to available quantities of the stock.
      """
      shares = self.get_shares()
      pending = self.get_transactions(executed=False)
      total = {}
      # Get the number of shares currently owned
      for (stock, info) in shares.iteritems():
         total[stock] = info['quantity']

      # Subtract the number of pending sell orders
      for (time, holding) in pending.iteritems():
         if (ndb.Key(urlsafe=holding['key']).get().type == 'sell'):
            if holding['stock'] in total:
               total[holding['stock']] -= holding['quantity']
            else:
               # Shouldn't normally happen
               total[holding['stock']] = holding['quantity']
      return total

   def get_total_shares_value(self, shares):
      """Get the current value for all shares owned and cumulate the value.

      Args:
         shares: A list of share objects.

      Returns:
         A single cumulative value of all shares
      """
      total_shares_value = 0
      share_data = memcache.get('share_data')
      if share_data is None:
         # Get data and put it into the same format as memcache would be
         share_data = {}
         yahoo_url = "https://query.yahooapis.com/v1/public/yql?q=select%20LastTradePriceOnly%20from%20yahoo.finance.quotes%20where%20symbol%20IN%20(" + ",%20".join('"' + key + '"' for key in shares.keys()) + ")%20&format=json&diagnostics=false&env=store%3A%2F%2Fdatatables.org%2Falltableswithkeys&callback="
         response = urlfetch.fetch(yahoo_url)
         data = json.loads(response.content)
         i = 0
         for share in shares:
            if (len(shares) == 1):
               share_data[str(share)] = data['query']['results']['quote']
            elif (len(shares) > 1):
               share_data[str(share)] = data['query']['results']['quote'][i]
            i+=1

      for share in shares:
         price = float(share_data[str(share)]['LastTradePriceOnly'])
         share_object = shares.get(share)
         share_object['price'] = price
         share_object['total_value'] = share_object['quantity'] * price
         share_object['net_gain'] = share_object['total_value'] - (share_object['purchase_price'] * share_object['quantity'])
         total_shares_value += share_object['total_value']

      return total_shares_value

   def get_pending_shares_value(self):
      """ Get the value associated with pending share transactions.

      Returns:
         The cumulative value of all pending transactions.
      """
      value = 0;
      pending_data = self.get_transactions(executed=False)
      for (time, holding) in pending_data.iteritems():
         if (holding['type'] == 'buy'):
            value += holding['price'] * holding['quantity']
      return value

   def delete_transaction(self, key):
      """Removes a transaction from the list of transactions.

         Args:
            key: The key corresponding to the Transaction model instance.

         Raises:
            ValueError: if key is not valid.
      """
      try:
         index = self.transactions.index(key)
         transaction = self.transactions.pop(index).get()

         # If deleting a pending transaction refund the money for a buy except for brokerage
         if (transaction.executed == False):
            if (transaction.type == 'buy'):
               self.cash = self.cash + transaction.quantity * transaction.price
         self.put()
      except ValueError:
         raise ValueError("Invalid key")

## ADDITIONAL RELATED PLAYER METHODS AND THE HANDLER FOR USER AUTHENTICATION ##

def login_required(handler):
   """Handler to enforce user login, add @login_required before method."""
   def check_login(self, *args, **kwargs):
      if not self.user:
         return self.redirect('/login')
      else:
         return handler(self, *args, **kwargs)
   return check_login

class UserHandler(webapp2.RequestHandler):
   """Extends base RequestHandler with methods required for session storage and
      user authentication.
   """
   # We cache what we can to avoid recomputing it with each request
   @webapp2.cached_property
   def session_store(self):
      return sessions.get_store(request=self.request)

   @webapp2.cached_property
   def session(self):
      return self.session_store.get_session(backend="datastore")

   # After request dispatched, persist changes to session object
   def dispatch(self):
      try:
         super(UserHandler, self).dispatch()
      finally:
         self.session_store.save_sessions(self.response)

   @webapp2.cached_property
   def auth(self):
      return auth.get_auth(request=self.request)

   @webapp2.cached_property
   def user(self):
      user = self.auth.get_user_by_session()
      return user

   @webapp2.cached_property
   def user_model(self):
      user_model, timestamp = self.auth.store.user_model.get_by_auth_token(
         self.user['user_id'],
         self.user['token']) if self.user else (None, None)
      return user_model