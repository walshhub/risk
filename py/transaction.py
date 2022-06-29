"""Transaction Model Class

   This module contains the model for transactions (i.e. buying and selling
   stocks) and all related functions.
"""

from google.appengine.ext import ndb

class Transaction(ndb.Model):
   """Stores information pertaining to an individual transaction/order.

   Attributes:
      type: The type of transaction ('buy' or 'sell').
      subtype: Details of the order type ('market', 'limit', or 'stop').
      stock: The three character ASX stock code.
      price: The price per share of the stock.
      quantity: The quantity of the stock being traded.
      timestamp: The current time when the order is first made.
      executed: Whether or not the transaction has been executed.
      fee: The brokerage fee.
      cashHistory: The users cash when the order is made (used to track a
         historical record of the users cash).
   """
   type = ndb.StringProperty(required=True, choices=['buy', 'sell'])
   subtype = ndb.StringProperty(required=True, choices=['market', 'limit', 'stop'])
   stock = ndb.StringProperty(required=True)
   price = ndb.FloatProperty(required=True)
   quantity = ndb.IntegerProperty(required=True)
   timestamp = ndb.DateTimeProperty(auto_now_add=True, required=False)
   executed = ndb.BooleanProperty(required=True)
   fee = ndb.FloatProperty(required=True)
   cashHistory = ndb.FloatProperty(required=False)

   @classmethod
   def new(cls, data):
      """Creates a new instance of the class and adds it to the datastore.
      
      Assumes data passed is valid.

      Args:
         data: A dictionary containing the model instance data.

      Returns:
         The new Transaction instance.
      """
      transaction = cls(type=data['type'], subtype=data['subtype'],
         stock=data['stock'], price=data['price'], quantity=data['quantity'],
         executed=data['executed'], fee=data['fee'], cashHistory=data['cashHistory']);
      transaction.put()
      return transaction

   @classmethod
   def is_valid(cls, data):
      """Checks if data in the dictionary is valid according to the model schema.

      Args:
         data: A dictionary containing data for this model.

      Returns:
         A boolean value that is true if the data is valid and false otherwise.
      """
      if ((data['type'] == 'buy' or data['type'] == 'sell')
         and (data['subtype'] == 'market' or data['subtype'] == 'limit' or data['subtype'] == 'stop')
         and data['price'] >= 0
         and data['quantity'] > 0
         and data['executed'] == True or data['executed'] == False):
         return True
      else:
         return False

   @classmethod
   def delete(cls, key):
      """ Deletes the transaction from the datastore.

      Args:
        key: The key corresponding to the transaction.

      Raises:
         AttributeError: if key is not valid.
      """
      try:
         transaction = key.get()
         transaction.key.delete()
      except AttributeError:
         raise AttributeError("Invalid key")
