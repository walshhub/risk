"""Market Depth Model Class

   This module represents the model of the market depth associated with a
   particular stock.
"""

from google.appengine.ext import ndb

import random
import numpy
import json

class Depth(ndb.Model):
   """Stores information pertaining to the market depth for a particular stock.

   Attributes:
      stock: The three character ASX stock code.
      bids: A dictionary of prices and volumes for the bid depth.
      asks: A dictionary of prices and volumes for the ask depth.
      max_bid: The maximum bid price in the depth.
      min_ask: The minimum ask price in the depth.
   """
   stock = ndb.StringProperty(required=True)
   bids = ndb.JsonProperty()
   asks = ndb.JsonProperty()
   max_bid = ndb.FloatProperty(required=True)
   min_ask = ndb.FloatProperty(required=True)

   @classmethod
   def new (cls, data):
      """Creates a new instance of the class and adds it to the datastore.
      
      Assumes data passed is valid.

      Args:
         data: A dictionary containing the model instance data.

      Returns:
         The new Depth model instance.
      """
      # The number of prices to generate order depths for
      NUM_PRICES = 10

      bids = json.dumps(cls.generate_depth('bid', data['max_bid'], data['avg_volume'], NUM_PRICES))
      asks = json.dumps(cls.generate_depth('ask', data['min_ask'], data['avg_volume'], NUM_PRICES))
      depth = cls(stock=data['stock'], bids=bids, asks=asks, max_bid=data['max_bid'], min_ask=data['min_ask'])
      depth.put()
      return depth

   @classmethod
   def generate_depth(cls, type, limit, avg_volume, num_prices):
      """Generates a dictionary of prices and volumes representing stock depth.

      Args:
         type: The depth type ('bid' or 'ask').
         limit: The minimum/maximum price to generate.
         avg_volume: The average volume around which to randomly generate values.
         num_prices: The number of prices at which to generate volumes.

      Returns:
         A dictionary mapping prices (keys) to volumes (values).
      """
      # The initial probability whereby an order price is skipped
      INIT_SKIP_PROB = 0.20

      # The amount to increment the probability of skipping an order price
      SKIP_PROB_INC = 0.02

      # The amount the order price changes
      PRICE_CHANGE = .01

      # Dict of prices
      depth = {}

      # Start off at the current price
      current_price = float(limit)

      # Based off observations, 0.001% seems to be mean volume for any one order for stocks over
      # $30, but for stocks immediately under $30 it seems to be 0.01%
      # NOTE: Check further and restrict to ASX200
      mean = 0.0001 * float(avg_volume)
      if (limit < 30):
         mean = 0.001 * float(avg_volume)

      # The initial probability
      p = INIT_SKIP_PROB

      # Algorithm: We'll generate it for 10 prices. We want to move down in .01
      # increments with perhaps a 20% chance of skipping an increment. This chance
      # increases as we get further away from the bid
      i = 0
      while (i < num_prices):
         # Only add the order to the depth with a probability of 1 - p
         # unless the order is at the bid limit (in which case that necessarily)
         # means an order should be there
         rand = random.random()

         if (rand > p or current_price == float(limit)):

            # Generate the volume for this price based off average daily volume.
            # Orders are very variable so SD is extremely large
            volume = numpy.random.normal(mean, mean*4)
            if (volume < 0): volume = volume * -1

            # Continually increase the probability of skipping an order
            # once we are past the first num_prices/2.
            if (i > (num_prices / 2)):
               p += SKIP_PROB_INC

            # Add the volume, num orders to the depth dict
            depth[round(current_price, 2)] = [round(volume, 0)]

            # Increment the counter
            i += 1

         # Decrement the price by PRICE_CHANGE
         if (type == 'bid'):
            current_price -= PRICE_CHANGE
         elif (type == 'ask'):
            current_price += PRICE_CHANGE

      return depth

   @classmethod
   def get(cls, data):
      """Gets the depth for a given stock, updates it, or generates it if none 
         exists.

      Args:
         data: A dictionary containing the stock and relevant information.

      Returns:
         The Depth model instance for the given stock.
      """
      depthQuery = Depth.query(Depth.stock == data['stock'])
      if (depthQuery.count() == 0):
         depth = Depth.new(data)
      else:
         depth = depthQuery.get()
         depth.update(data['max_bid'], data['min_ask'], data['avg_volume'])
         depth.put()
      return depth

   def update(self, new_bid, new_ask, avg_volume):
      """Updates the depth to fit in with the current bid and ask prices.

      Args:
         new_bid: The new bid price.
         new_ask: The new ask price.
         avg_volume: The average volume of the stock.
      """
      if (new_bid < self.max_bid):
         new_bid_list = self.update_int_depth('bid', new_bid, avg_volume)
      elif (new_bid > self.max_bid):
         new_bid_list = self.update_ext_depth('bid', new_bid, avg_volume)
      else:
         # If the new_bid is the same as the max_bid in the previous depth
         # we don't change the depth
         new_bid_list = json.loads(self.bids)
         new_bid = self.max_bid

      # Ensure the new_bid is the top of the new_bid_list
      new_bid_list = self.ensure_max(new_bid_list, new_bid)

      if (new_ask > self.min_ask):
         new_ask_list = self.update_int_depth('ask', new_ask, avg_volume)
      elif (new_ask < self.min_ask):
         new_ask_list = self.update_ext_depth('ask', new_ask, avg_volume)
      else:
         # If the new_ask is the same as the min_ask in the previous depth
         # we don't change the depth
         new_ask_list = json.loads(self.asks)
         new_ask = self.min_ask

      # Ensure the new_ask is the top of the new_ask_list
      new_ask_list = self.ensure_min(new_ask_list, new_ask)

      # Update the bids and the new maximum bid/min ask
      self.bids = json.dumps(new_bid_list)
      self.asks = json.dumps(new_ask_list)
      self.max_bid = new_bid
      self.min_ask = new_ask

   def update_int_depth(self, type, limit, avg_volume):
      """Updates depth where there has been an internal overlap.

      i.e. The new bid is less than the old bid, or new ask is greater than the
      old ask.

      Args:
         type: The price type ('bid' or 'ask').
         limit: The new limit for the price (new bid or new ask).
         avg_volume: The average volume for the share.

      Returns:
         The updated Depth model instance.
      """
       # The amount the order price changes
      PRICE_CHANGE = .01

      new_depth = {}
      if (type == 'bid'):
         old_depth = json.loads(self.bids)
      elif (type == 'ask'):
         old_depth = json.loads(self.asks)

      new_limit = limit
      for price in old_depth.iterkeys():
         # Keep all the elements in the old list that are in the
         # constraints of the new limit
         if ((type == 'bid' and float(price) <= limit) or
            (type == 'ask' and float(price) >= limit)):
            new_depth[price] = old_depth[price]

         # Establish the minimum (for bid) or maximum (for ask)
         # element in the new list and generate the remainder of elements
         # from that
         if (type == 'bid' and float(price) <= new_limit):
            new_limit = float(price) - PRICE_CHANGE
         elif (type == 'ask' and float(price) >= new_limit):
            new_limit = float(price) + PRICE_CHANGE


      # Generate the remaining elements
      new_depth.update(Depth.generate_depth(type,
         new_limit, avg_volume, 10 - len(new_depth)))

      return new_depth

   def update_ext_depth(self, type, limit, avg_volume):
      """Updates depth where there has been an external overlap.

      i.e. The new bid is greater than the old bid, or new ask is less than the
      old ask.

      Args:
         type: The price type ('bid' or 'ask').
         limit: The new limit for the price (new bid or new ask).
         avg_volume: The average volume for the share.

      Returns:
         The updated Depth model instance.
      """
      if (type == 'bid'):
         old_depth = json.loads(self.bids)
      elif (type == 'ask'):
         old_depth = json.loads(self.asks)

      # Generate an initial list of 10, combine it with the previous list
      # and then select the top 10
      new_depth = Depth.generate_depth(type, limit, avg_volume, 10)
      new_depth.update(old_depth)
      i = 0
      for key in sorted(new_depth.iterkeys()):
         if (i >= 10):
            del new_depth[key]
         i += 1

      return new_depth

   def ensure_max(self, depth_dict, max_val):
      """Makes sure max is the maxmimum element in depth_dict.

      If max is not in the dict, it replaces the maximum value in the dict.

      Args:
         depth_dict: A dictionary of (price, volume) pairs representing the depth.
         max_val: The maximum price value that should be in the dictionary.

      Returns:
         The updated depth dictionary.
      """
      cur_max = max(depth_dict.iterkeys())
      if (float(max_val) > float(cur_max)):
         depth_dict[max_val] = depth_dict[cur_max]
         depth_dict.pop(cur_max, None)
      return depth_dict

   def ensure_min(self, depth_dict, min_val):
      """Makes sure min is the minimum element in depth_dict.

      If min is not in the dict, it replaces the minimum value in the dict.

      Args:
         depth_dict: A dictionary of (price, volume) pairs representing the depth.
         min_val: The minimum price value that should be in the dictionary.

      Returns:
         The updated depth dictionary.
      """
      cur_min = min(depth_dict.iterkeys())
      if (float(min_val) < float(cur_min)):
         depth_dict[min_val] = depth_dict[cur_min]
         depth_dict.pop(cur_min, None)
      return depth_dict
