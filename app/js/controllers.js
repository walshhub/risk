'use strict';

var riskControllers = angular.module('riskControllers', ["chart.js"]);

// Handles everything relating to the quote page
riskControllers.controller('QuoteController', ['$scope', '$log', '$http', '$templateCache', '$q', 'UserFactory', 'OrderFactory', '$modal', 'user',
   function($scope, $log, $http, $templateCache, $q, UserFactory, OrderFactory, $modal, user) {
   $scope.loggedIn = user.success;
   $scope.pageElements = [];

   // Used to toggle whether ASX, SMA and EMA graphs should be displayed. Need
   // to be in an object (as opposed to primitives) because of scope issues with
   // bootstrap accordions. The flags are toggled whenever the checkboxes are
   // toggled. They are additionaly set to false whenever a stock is selected,
   // i.e., set to false whenever fetch() is called.
   $scope.overlayFlags = {
      ASX : false,
      EMA : false,
      SMA : false
   };

   // Get the stock codes and attach it to the codes dict
   $http.get('app/static/codes200A.json').then(function(response) {
      $scope.codes = response.data;
      $scope.model = {typedStock: $scope.codes[0].name};
      $scope.stock = $scope.codes[0];
      $scope.fetch();
   });

   $scope.$watch('model.typedStock',function(){})

   $scope.togglePageElms = function(pageElement) {
      var index = $scope.pageElements.indexOf(pageElement);
      if (index == -1) {
         $scope.pageElements.push(pageElement);
      } else {
         $scope.pageElements.splice(index, 1);
      }
   }

   // Gets the current information for the stock (includes price and the depth)
   $scope.fetchCurrentInfo = function() {
      $scope.processing = "Processing...";
      $scope.price = null;
      $scope.url = "https://query.yahooapis.com/v1/public/yql?q=" +
                     "select%20*%20from%20yahoo.finance.quotes%20where%20symbol%3D%22" +
                     $scope.stock.code +
                     "%22&format=json&diagnostics=false&env=store%3A%2F%2Fdatatables.org%2Falltableswithkeys&callback=";
      var deferred = $q.defer();

      // Perform query to get current info on selected stock
      $http({method: 'GET', url: $scope.url, cache: $templateCache}).then(function(response) {
         $scope.yahooStatus = response.status;
         $scope.data = response.data;
         if ($scope.data != null &&
            $scope.data.query != null &&
            $scope.data.query.results != null &&
            $scope.data.query.results.quote != null) {

            $scope.quote = $scope.data.query.results.quote;
            $scope.price = parseFloat($scope.quote.LastTradePriceOnly);

            // Fetch market depth
            var parameter = JSON.stringify({'stock': $scope.stock.code, 'max_bid': parseFloat($scope.quote.Bid), 'min_ask': parseFloat($scope.quote.Ask), 'avg_volume': parseFloat($scope.quote.AverageDailyVolume)});
            $http.post('/depth', parameter).success(function(response) {
               $scope.depth = response;
               $scope.depthBids = $scope.$eval($scope.depth.bids);
               $scope.depthAsks = $scope.$eval($scope.depth.asks);

               //Get a list of depth bids in descending order
               $scope.depthKeys = [];
               for(var key in $scope.depthBids) {
                  if($scope.depthBids.hasOwnProperty(key)) { //to be safe
                     $scope.depthKeys.push(key);
                  }
               }
               $scope.depthKeys.sort(function(a, b){return b-a});

               deferred.resolve();
            }, function(response) {
               $scope.depthStatus = "Cannot get market depth. Please ensure you have selected a stock and try again"
               deferred.reject();
            });
         }
         $scope.processing = "";
      }, function(response) {
         $scope.data = response.data || "Request failed";
         $scope.yahooStatus = response.status;
         $scope.processing = "";
         deferred.reject();
      });
      return deferred.promise;
   }

   $scope.fetchDividends = function() {
      $scope.getCurrentDate();
      $scope.d1 = "1960-01-01";
      var divUrl = "https://query.yahooapis.com/v1/public/yql?q=" +
      "select%20*%20from%20yahoo.finance.dividendhistory%20where%20symbol%20%3D%20%22" +
      $scope.stock.code + "%22%20and%20startDate%20%3D%20%22"+
      $scope.d1 +"%22%20and%20endDate%20%3D%20%22"+
      $scope.d2 +"%22&diagnostics=false&format=json&env=store%3A%2F%2Fdatatables.org%2Falltableswithkeys";

      $scope.dividends = [];
      $http({method: 'GET', url: divUrl, cache: $templateCache})
      .then(function(response) {
         if (response.data.query.count == 0) {
            $scope.dividends.LastDate = "None found!"
            $scope.dividends.LastAmount = "None found!"
         } else {
            $scope.dividends.responseStatus = response.status;
            $scope.dividends.responseData = response.data.query.results.quote;
            // Most recent dividend always indexed at 0
            $scope.dividends.LastDate = $scope.dividends.responseData[0].Date;
            $scope.dividends.LastAmount = $scope.dividends.responseData[0].Dividends;
         }
      }, function(response) {
         // nothing, errors handled above
      });
   }

   // Fetch the news stories for the selected stock
   $scope.fetchNews = function() {
      var url = "//query.yahooapis.com/v1/public/yql?q=select%20*%20from" +
      "%20html%20where%20url%3D'https%3A%2F%2Fau.finance.yahoo.com%2Fq%2Fp%3Fs%3D" +
      $scope.stock.code + "'%20and%20xpath%3D'%2F%2Ful%2Fli%5Bcite%5D'&" +
      "format=json&diagnostics=true";

      $http.get(url)
      .success(function(response) {
         if (response.query.results) {
            // If only one story is returned, some extra processing is required.
            if (response.query.results.li.a) {
               var s = [];
               s.push(response.query.results.li)
               $scope.stories = s;
            } else {
               $scope.stories = response.query.results.li;
            }
         } else {
            $scope.stories = null;
         }
      })
      .error(function(response) {
         $scope.stories = null;
      });
   }

   // Create the historical graph of the selected stock
   $scope.fetchHistoricalPrices = function() {

      $scope.getCurrentDate();

      // URL to get historical prices of selected stock
      $scope.historicalURL = "https://query.yahooapis.com/v1/public/yql?q=" +
         "select%20*%20from%20yahoo.finance.historicaldata%20where%20symbol%20%3D%20%22" +
         $scope.stock.code + "%22%20and%20startDate%20%3D%20%22" +
         $scope.d1 + "%22%20and%20endDate%20%3D%20%22" +
         $scope.d2 + "%22&format=json&diagnostics=false&" +
         "env=store%3A%2F%2Fdatatables.org%2Falltableswithkeys";

      // Initialise chart
      $scope.chartConfig = {
            options: {
               chart: {
                  zoomType: 'x'
               },
               rangeSelector: {
                  // selected: 1,
                  enabled: true
               },
               navigator: {
                  enabled: true,
                  series: {
                     data: $scope.chartPrices
                  }
               }
            },
            title: {
               text:'',
               style: {
                  display: 'none'
               }
            },

            useHighStocks: true
         }

      // Perform query to get historical prices of selected stock
      $http({method: 'GET', url: $scope.historicalURL, cache: $templateCache})
      .then(function(response) {
         $scope.historicalStatus = response.status;
         $scope.historicalDataQuote = response.data.query.results.quote;

         // Create data for graphs
         $scope.chartPrices = [];
         $scope.chartVolumes = [];

         var today = new Date();
         var dd = today.getDate();
         var mm = today.getMonth(); //January is 0!
         var yyyy = today.getFullYear();

         // Maybe += 5
         for (var i = $scope.historicalDataQuote.length - 1; i >= 0; i -= 1) {
            var quoteDate = $scope.historicalDataQuote[i].Date;

            var yyyy = quoteDate.substring(0,4);
            var mm   = quoteDate.substring(5,7)-1;
            var dd   = quoteDate.substring(8,10);

            var currentList = $scope.chartPrices;
            var newList = currentList.concat([[Date.UTC(yyyy, mm, dd), parseFloat($scope.historicalDataQuote[i].Close)]]);
            $scope.chartPrices = newList;

            currentList = $scope.chartVolumes;
            newList = currentList.concat([[Date.UTC(yyyy, mm, dd), parseFloat($scope.historicalDataQuote[i].Volume)]]);
            $scope.chartVolumes = newList;
         }

         $scope.chartConfig = {
            options: {
               chart: {
                  zoomType: 'x'
               },
               rangeSelector: {
                  // selected: 1,
                  enabled: true
               },
               navigator: {
                  enabled: true,
                  series: {
                     data: $scope.chartPrices
                  }
               }
            },
            title: {
               text:'',
               style: {
                  display: 'none'
               }
            },

            xAxis: [{
               type: 'datetime',
               lineWidth: 1,
               tickWidth: 2,
               endOnTick: false,
               startOnTick: false,
               ordinal: false,
            }],

            yAxis: [{
                labels: {
                    align: 'right',
                    x: -3
                },
                title: {
                    text: 'Price'
                },
                height: '60%',
                lineWidth: 2
            }, {
                labels: {
                    align: 'right',
                    x: -3
                },
                title: {
                    text: 'Volume'
                },
                top: '65%',
                height: '35%',
                offset: 0,
                lineWidth: 2
            }],

            series: [{
               // id: 1,
               name: 'Equity price',
               data: $scope.chartPrices
            }, {
               // id: 2,
               type: 'column',
               yAxis: 1,
               name: 'Volume',
               data: $scope.chartVolumes
            }],

            useHighStocks: true
         }

         $scope.processingHistory = "";

         // Get the ASK prices after everything has been done
         $scope.getASXPrices();
      }, function(response) {
        //do nothing
      });
      $scope.processingHistory = "Processing...";



   }

   $scope.addAsxOverlay = function() {
      if (!$scope.overlayFlags.ASX) {
         // Remove ASX overlay
         for (var i = 0; i < $scope.chartConfig.series.length; i++) {
            if ($scope.chartConfig.series[i].name == "ASX") {
               $scope.chartConfig.series[i].visible = false;
               return true;
            }
         }
      }
      if (typeof $scope.asxPrices != "undefined" && $scope.asxPrices[0][1] == $scope.chartPrices[0][1]) {
         // Avoid recalculating if ASX data already defined
         for (var i = 0; i < $scope.chartConfig.series.length; i++) {
            if ($scope.chartConfig.series[i].name == "ASX") {
               $scope.chartConfig.series[i].visible = true;
               return true;
            }
         }

         // Otherwise series has not been pushed. Push the series
         $scope.chartConfig.series.push({
            name: "ASX",
            data: $scope.asxPrices,
            color: '#50B432'
         });
      } else {
         $scope.getASXPrices();
      }
   }

   $scope.addSmaOverlay = function() {
      if (!$scope.overlayFlags.SMA) {
         // Remove SMA overlay
         for (var i = 0; i < $scope.chartConfig.series.length; i++) {
            if ($scope.chartConfig.series[i].name == "SMA") {
               $scope.chartConfig.series[i].visible = false;
               return true;
            }
         }
      }
      if (typeof $scope.smaPrices != "undefined" && $scope.smaPrices[0][1] == $scope.chartPrices[0][1]) {
         for (var i = 0; i < $scope.chartConfig.series.length; i++) {
            if ($scope.chartConfig.series[i].name == "SMA") {
               $scope.chartConfig.series[i].visible = true;
               return true;
            }
         }
         // If we haven't found SMA in the chartConfig yet, it's because it's been calculated by
         // addEmaOverlay but not added. Adding here:
         $scope.chartConfig.series.push({
            name: "SMA",
            data: $scope.smaPrices,
            color: '#CC33FF'
         });
      } else {
         var bIncrement = 10;
         $scope.smaPrices = calculateSMA(bIncrement);
         $scope.chartConfig.series.push({
            name: "SMA",
            data: $scope.smaPrices,
            color: '#CC33FF'
         });
      }
   }

   $scope.addEmaOverlay = function() {
      if (!$scope.overlayFlags.EMA) {
         // Remove EMA overlay
         for (var i = 0; i < $scope.chartConfig.series.length; i++) {
            if ($scope.chartConfig.series[i].name == "EMA") {
               $scope.chartConfig.series[i].visible = false;
               return true;
            }
         }
      }
      if (typeof $scope.emaPrices != "undefined" && $scope.emaPrices[0][1] == $scope.chartPrices[0][1]) {
         for (var i = 0; i < $scope.chartConfig.series.length; i++) {
            if ($scope.chartConfig.series[i].name == "EMA") {
               $scope.chartConfig.series[i].visible = true;
               return true;
            }
         }
      } else {
         var bIncrement = 10;
         if (typeof $scope.smaPrices == "undefined" || $scope.smaPrices[0][1] != $scope.chartPrices[0][1]) {
            // EMA uses SMA prices, so if SMA undefined or wrong, recalculate it.
            $scope.smaPrices = calculateSMA(bIncrement);
         }
         var multiplier = 2/(bIncrement + 1);
         // Start EMA with first element of SMA, build iteratively on this
         $scope.emaPrices = [$scope.smaPrices[0]];
         for (var j = 1; j < $scope.smaPrices.length; j++) {
            var histIndex = $scope.historicalDataQuote.length - 1 - j;
            // From http://stockcharts.com/school/doku.php?id=chart_school%3Atechnical_indicators%3Amoving_averages:
            // EMA: {Close - EMA(previous day)} x multiplier + EMA(previous day)
            var currentEma =
               ($scope.historicalDataQuote[histIndex].Close - $scope.emaPrices[j-1][1])*multiplier + $scope.emaPrices[j-1][1];
            var currentList = $scope.emaPrices;
            var newList = currentList.concat([[$scope.smaPrices[j][0], parseFloat(currentEma.toFixed(3))]]);
            $scope.emaPrices = newList;
         }

         $scope.chartConfig.series.push({
            name: "EMA",
            data: $scope.emaPrices,
            color: '#FF9900'
         });
      }
   }

   function calculateSMA(bIncrement) {
      var prices = [];
      for (var i = $scope.historicalDataQuote.length - 1; i >= 0; i -= 1) {
         var quoteDate = $scope.historicalDataQuote[i].Date;

         var yyyy = quoteDate.substring(0,4);
         var mm   = quoteDate.substring(5,7)-1;
         var dd   = quoteDate.substring(8,10);

         // Set increment to min(baseInc, length-1-i)
         var inc = $scope.historicalDataQuote.length - 1 - i;
         if (inc > bIncrement) {
            inc = bIncrement;
         }
         // Calculate average over last {inc} days
         var avg = 0;
         for (var j = 0; j < inc && j <= i; j++) {
            avg += parseFloat($scope.historicalDataQuote[i-j].Close)
         }
         if (j == 0) {
            avg = $scope.historicalDataQuote[i].Close;
            j = 1;
         }
         avg = avg/j;

         var currentList = prices;
         var newList = currentList.concat([[Date.UTC(yyyy, mm, dd), parseFloat(avg.toFixed(3))]]);
         prices = newList;
      }
      return prices;
   }

   $scope.getASXPrices = function() {
      // Calculate normalised ASX data
      $scope.processingHistory = "Processing...";
      $scope.getCurrentDate();

      $scope.asxURL = "https://query.yahooapis.com/v1/public/yql?q=" +
         "select%20*%20from%20yahoo.finance.historicaldata%20where%20symbol%20%3D%20%22" +
         "ASX.AX%22%20and%20startDate%20%3D%20%22" +
         $scope.d1 + "%22%20and%20endDate%20%3D%20%22" +
         $scope.d2 + "%22&format=json&diagnostics=false&" +
         "env=store%3A%2F%2Fdatatables.org%2Falltableswithkeys";

      // grab ASX historical data over same timeframe for ASX overlay
      $http({method: 'GET', url: $scope.asxURL, cache: $templateCache})
      .then(function(response) {
         $scope.asxStatus = response.status;
         if ($scope.asxStatus != 200) {
            $scope.processingHistory = "Something went wrong with the Yahoo api query";
         }
         $scope.asxDataQuote = response.data.query.results.quote;

         $scope.asxPrices = [];
         // Maybe += 5
         for (var i = $scope.asxDataQuote.length - 1; i >= 0; i -= 1) {
            var quoteDate = $scope.asxDataQuote[i].Date;

            var yyyy = quoteDate.substring(0,4);
            var mm   = quoteDate.substring(5,7)-1;
            var dd   = quoteDate.substring(8,10);

            var currentList = $scope.asxPrices;
            var price = $scope.asxDataQuote[i].Close;
            var newList = currentList.concat([[Date.UTC(yyyy, mm, dd), price]]);
            $scope.asxPrices = newList;
         }


         // normalise ASX to current stock
         var denom = $scope.asxPrices[0][1]/$scope.chartPrices[0][1];
         for (var j = 0; j < $scope.asxPrices.length; j++) {
            $scope.asxPrices[j][1] = parseFloat(($scope.asxPrices[j][1]/denom).toFixed(3));
         }

         $scope.processingHistory = "";
      }, function(response) {
         //nada
      });
   }

   // Initialises the current date (d1, d2)
   $scope.getCurrentDate = function() {
      var today = new Date();
      var dd = today.getDate();
      var mm = today.getMonth()+1; //January is 0!
      var yyyy = today.getFullYear();
      if(dd<10) dd='0'+dd;
      if(mm<10) mm='0'+mm;
      $scope.d1 = yyyy - 1 + "-" + mm + "-" + dd; // "2014-01-01";
      $scope.d2 = yyyy + "-" + mm + "-" + dd;     // "2014-12-31";
   }

   // Handles the selection of a stock code
   $scope.onSelect = function($item, $model, $label) {
      $scope.stock = $item;
      $scope.fetch();
   };

   $scope.fetch = function() {
      // Initialise call variables
      $scope.response = null;
      $scope.data = null;
      $scope.quote = null;
      $scope.graph_scale = "year";

      // Set flags to false so graph checkboxes revert to correct state.
      $scope.overlayFlags.ASX = false;
      $scope.overlayFlags.EMA = false;
      $scope.overlayFlags.SMA = false;

      // Fetch the relevant information
      $scope.fetchCurrentInfo();
      $scope.fetchNews();
      $scope.fetchHistoricalPrices();
      $scope.fetchDividends();
   };

   // Modal to handle displaying company list
   $scope.openCompanyList = function (error) {
         $scope.selection = "";
         var modalInstance = $modal.open({
            animation: true,
            templateUrl: '/app/partials/companies.html',
            controller: 'CompanyController',
            scope: $scope
         });

         modalInstance.result.then(function (selectedCompany) {
            $scope.stock = selectedCompany;
            $scope.model.typedStock = selectedCompany.name;
            $scope.fetch();
         });
   };

   // Close the modal
   $scope.cancel = function () {
      $modalInstance.dismiss();
   };

   $scope.openOrderForm = function (error) {
      if ($scope.model.typedStock == $scope.stock.name) {
         $scope.status = "";
         var modalInstance = $modal.open({
            animation: true,
            templateUrl: '/app/partials/orderform.html',
            controller: 'FormController',
            scope: $scope
         });

         modalInstance.result.then(function (status) {
            $scope.status = status;
         }, function (status) {
            if (status != 'escape key press' && status != 'backdrop click') {
               $scope.status = status;
            }
         });
      } else {
         $scope.status = "Please select a stock";
      }
   };


}]);


riskControllers.controller('CompanyController', ['$scope', '$modalInstance',
   function($scope, $modalInstance) {
   // Modal to handle displaying company list
   $scope.selectCompany = function(company) {
      $modalInstance.close(company);
   }

   // Close the modal
   $scope.cancel = function () {
      $modalInstance.dismiss();
   };
}]);



// Handles everything related to the order form
riskControllers.controller('FormController', ['$scope', '$log', '$http', '$templateCache', '$q', 'UserFactory', 'OrderFactory', '$modal', '$modalInstance', 'ngToast',
   function($scope, $log, $http, $templateCache, $q, UserFactory, OrderFactory, $modal, $modalInstance, ngToast) {

   // Initially the form has not been submitted
   $scope.submitted = false;

   // There is no order status
   $scope.status = "";

   // Initialise order
   $scope.order = {};
   $scope.order.fee = 20.00;
   $scope.order.subtype = "market"
   if ($scope.sellingFromPortfolio) {
      $scope.order.stock = $scope.sellCode;
      $scope.order.type = "sell"
   } else {
      $scope.order.stock = $scope.stock.code;
      $scope.order.type = "buy"
   }

   $scope.order.price = $scope.price;


   // --------------------------------------------------------------------------
   // Code duplicated from Quote Controller!!!
   $scope.fetchCurrentInfo = function() {

      $scope.quote = null;
      $scope.price = null;
      $scope.url = "https://query.yahooapis.com/v1/public/yql?q=" +
                     "select%20*%20from%20yahoo.finance.quotes%20where%20symbol%3D%22" +
                     $scope.order.stock +
                     "%22&format=json&diagnostics=false&env=store%3A%2F%2Fdatatables.org%2Falltableswithkeys&callback=";
      var deferred = $q.defer();

      // Perform query to get current info on selected stock
      $http({method: 'GET', url: $scope.url, cache: $templateCache}).then(function(response) {
         $scope.yahooStatus = response.status;
         $scope.data = response.data;
         if ($scope.data != null &&
            $scope.data.query != null &&
            $scope.data.query.results != null &&
            $scope.data.query.results.quote != null) {

            $scope.quote = $scope.data.query.results.quote;
            $scope.price = $scope.quote.Bid;
            deferred.resolve();
         }
      }, function(response) {
         $scope.data = response.data || "Request failed";
         $scope.yahooStatus = response.status;
         deferred.reject();
      });
      return deferred.promise;
   }



   // --------------------------------------------------------------------------


   $scope.updateQuantity = function() {
      $scope.order.quantity = parseInt($scope.order.totalPrice / $scope.order.price);
   }

   $scope.updateTotalPrice = function() {
      $scope.order.totalPrice = parseFloat(($scope.order.quantity * $scope.order.price).toFixed(2));
   }

   $scope.updatePriceDisplay = function() {
      $scope.status = "";
      if ($scope.quote == null) {
         var deferred = $scope.fetchCurrentInfo();
         deferred.then(function () {
            $scope.updateMarketPrice();
         });
      } else {
         $scope.updateMarketPrice();
      }
   }


   $scope.updateMarketPrice = function() {
      if ($scope.order.subtype == 'market') {
         if ($scope.order.type == 'buy') {
            $scope.order.price = parseFloat($scope.quote.Ask);
            $scope.updateTotalPrice();
         } else if ($scope.order.type == 'sell') {
            $scope.order.price = parseFloat($scope.quote.Bid);
            $scope.updateTotalPrice();
         }
      }
   }

   // Modal to handle confirmation screen
   $scope.openOrderConfirm = function (error) {
      $scope.submitted = true;
      // Formatting validation
      if ($scope.order.subtype == "limit"
         && ($scope.order.price > $scope.quote.Ask && $scope.order.type == "buy")) {
         $scope.status = "A limit buy order must have an order price less than or equal to the Ask";
      } else if ($scope.order.subtype == "limit"
         && ($scope.order.price < $scope.quote.Bid && $scope.order.type == "sell")) {
         $scope.status = "A limit sell order must have an order price greater than or equal to the Bid";
      } else if ($scope.order.subtype == "stop"
         && ($scope.order.price < $scope.quote.Ask && $scope.order.type == "buy")) {
         $scope.status = "A stop buy order must have an order price greater than or equal to the Ask";
      } else if ($scope.order.subtype == "stop"
         && ($scope.order.price > $scope.quote.Bid && $scope.order.type == "sell")) {
         $scope.status = "A stop sell order must have an order price less than or equal to the Bid";
      } else if (($scope.order.type == "buy" ||  $scope.order.type == "sell")
         && ($scope.order.subtype == "market" || $scope.order.subtype == "limit" || $scope.order.subtype == "stop")
         && $scope.order.stock != null
         && $scope.order.price >= 0
         && $scope.order.quantity > 0) {

         var modalInstance = $modal.open({
            animation: true,
            templateUrl: '/app/partials/confirmation.html',
            controller: 'OrderController',
            scope: $scope
         });
         modalInstance.result.then(function (status) {
            $modalInstance.close();
            $scope.status = status;
            ngToast.create({
               content: "Order placed!",
               className: "success",
               dismissButton: true,
               dismissOnClick: false,
               dismissOnTimeout: true,
               timeout: 1500
            });
         }, function (status) {
            if (status != 'escape key press' && status != 'backdrop click') {
               $scope.status = status;
            } else {
               $modalStack.dismissAll();
            }
         });
      } else {
         $scope.status = "Order Failed! Please make sure all fields are valid";
      }
   };

   // Close the modal
   $scope.cancel = function () {
      $modalInstance.close();
   };

}]);

//Porfolio controller
riskControllers.controller('PortfolioController', ['$scope', '$http', '$timeout', '$q', '$templateCache', '$location', '$modal', 'UserFactory', 'OrderFactory', 'data', 'ngToast',
      function($scope, $http, $timeout, $q, $templateCache, $location, $modal, UserFactory, OrderFactory, data, ngToast) {

   $scope.refresh = function(chart) {
      var deferred = $scope.getPortfolio();
      if (chart) {
         $scope.processing = "Processing ...";
         deferred.then(function () {
            $scope.getPortfolioChart();
         });
      }
      ngToast.create({
         content: "Page refreshed!",
         className: "info",
         dismissButton: true,
         dismissOnClick: false,
         dismissOnTimeout: true,
         timeout: 1500
      });
   }

   // Used on the portfolio page to determine whether there are any current
   // holdings or pending orders to display
   $scope.Object = Object;
   $scope.objectSize = function(object) {
      if (object) {
         return Object.keys(object).length;
      } else {
         return 0;
      }
   }

   // Gets the information from the user to populate the portfolio
   $scope.getPortfolio = function() {
      var deferred = $q.defer();
      UserFactory.get({'cash':true, 'share':true, 'pending':true, 'holdings':true, 'codes':true, 'history':true}, function(response){
         $scope.loggedIn = true;
         $scope.user = response;
         $scope.codes = $scope.user.codes;
         $scope.holdings = $scope.user.holdings;
         $scope.transHistory = $scope.user.history;
         deferred.resolve();
      }, function(response) {
         $scope.status = "Failed to view portfolio!"
         $scope.loggedIn = false;
         deferred.reject();
      });
      return deferred.promise
   };

   // Initialises the variables for the portfolio chart
   $scope.initPortfolioChart = function() {
       // Get todays date in the form (yyyy-mm-dd)
      var today = new Date();
      var dd = today.getDate();
      var mm = today.getMonth()+1; //January is 0
      var yyyy = today.getFullYear();
      if(dd<10) dd='0'+dd;
      if(mm<10) mm='0'+mm;
      $scope.tday = yyyy + "-" + mm + "-" + dd;

      // Initialise the users first share to be today
      $scope.firstTradeDate = $scope.tday;

      // The dates the shares are held
      $scope.shareDates = {};

      // Initialise the chart
      $scope.chartConfig = {
         options: {
            chart: {
               zoomType: 'x'
            },
            rangeSelector: {
               // selected: 1,
               enabled: true
            },
            navigator: {
               enabled: true
            }
         },
         title: {
            text:'Historical Performance',
         },
         xAxis: [{
            type: 'datetime',
            lineWidth: 1,
            tickWidth: 2,
            endOnTick: false,
            startOnTick: false,
            ordinal: false,
         }],

         yAxis: [{
            labels: {
               align: 'right',
               x: -3
            },
            title: {
                 text: 'Price'
            },
            height: '60%',
            lineWidth: 2
         }]
      }
   }

   $scope.drawPortfolioChart = function(chartPrices) {
      $scope.chartConfig = {
         options: {
            chart: {
               zoomType: 'x'
            },
            rangeSelector: {
               // selected: 1,
               enabled: true
            },
            navigator: {
               enabled: true,
               series: {
                  data: chartPrices
               }
            }
         },
         title: {
            text:'Historical Performance',
         },

         xAxis: [{
            type: 'datetime',
            lineWidth: 1,
            tickWidth: 2,
            endOnTick: false,
            startOnTick: false,
            ordinal: false,
         }],

         yAxis: [{
            labels: {
               align: 'right',
               x: -3
            },
            title: {
                 text: 'Price'
            },
            height: '60%',
            lineWidth: 2
         }],

         series: [{
            // id: 1,
            name: 'Portfolio Value',
            data: chartPrices
         }],

         useHighStocks: false
      }
      $scope.processing = "";
   }

   // Gets the number of a particular stock owned at a particular date
   // by following all the transactions up to that date
   $scope.getNumSharesOwned = function(code, date) {
      var quantity = 0;
      angular.forEach($scope.transHistory, function(transaction) {
         var time = transaction.timestamp;

         if (new Date(time.substring(0,10)).getTime() > new Date(date).getTime()) {
            // We don't want to pay attention to transactions after our date
         } else {
            if (transaction.type == 'buy' && transaction.stock == code) {
               quantity += transaction.quantity;
            } else if (transaction.type == 'sell' && transaction.stock == code) {
               quantity -= transaction.quantity;
            }
         }
      });
      return quantity;
   }


   // Gets the share price at a certain date
   $scope.getSharePriceAtDate = function(code, date) {
      var price = 1;
      angular.forEach($scope.historicalDataQuote, function(obj) {
         // Checks to see if the date is +- an hour (to account for daylight savings)
         // and if so, that is the share price for the date
         var historicalDate = new Date(obj.Date).getTime();
         var dateUpper = new Date(date);
         dateUpper.setHours(dateUpper.getHours() + 1);
         var dateLower = new Date(date);
         dateLower.setHours(dateLower.getHours() - 1);
         if (obj.Symbol == code && historicalDate <= dateUpper.getTime() && historicalDate >= dateLower.getTime()) {
            price = obj.Close;
         }
      });
      return price;
   }

   // Gets the latest version of the user's cash (history) at a certain date
   $scope.getCashHistory = function(code, date) {
      var cash = -1;
      var latestTimestamp = "";
      angular.forEach($scope.transHistory, function(transaction) {
         var time = transaction.timestamp;
         // Ensures you get the most recent cash history for that date
         // Handles daylight savings
         var timestampDate = new Date(time.substring(0,10)).getTime()
         var dateUpper = new Date(date);
         dateUpper.setHours(dateUpper.getHours() + 1);
         var dateLower = new Date(date);
         dateLower.setHours(dateLower.getHours() - 1);
         if (timestampDate >= dateLower && timestampDate <= dateUpper &&
            (latestTimestamp == "" || timestampDate > new Date(latestTimestamp).getTime())) {
            cash = transaction.cashHistory;
            latestTimestamp = time;
         }
      });
      return cash;
   }

   // With the user having no transaction history or only having
   // transaction history for one day - just return the max value for their previous days
   // and their total portfolio value for the last day
   $scope.getPortfolioValue = function() {
      var curDate = new Date($scope.birthday);
      var chartPrices = [];
      while (curDate.getTime() <= new Date().getTime()) {
         // If this is the last day get the users porfolio value
         // otherwise they have the maximum value
         var tempDate = new Date(curDate);
         tempDate.setDate(tempDate.getDate() + 1);
         if (tempDate.getTime() >= new Date().getTime()) {
            var price = $scope.user.cash + $scope.user.share + $scope.user.pendingVal;
         } else {
            var price = 50000;
         }
         var currentList = chartPrices;
         var newList = currentList.concat([[parseInt(curDate.getTime()), parseFloat(price.toFixed(2))]]);
         chartPrices = newList;
         curDate.setDate(curDate.getDate() + 1);
      }
      return chartPrices;
   }

   $scope.getPortfolioChart = function() {
      // Initialise the variables
      $scope.initPortfolioChart();
      $scope.processing = "Processing ...";
      var i = 0;
      var codeString = "";
      // Get the date of when the user bought each share and sold each share
      // and store that information in a hash
      angular.forEach($scope.codes, function(date, code) {
         // Get the first trade ever for this user (i.e. the starting date to collect the data)
         if (date < $scope.firstTradeDate) {
            $scope.firstTradeDate = date;
         }

         // Dates are in the format:
         // yyyy-mm-dd~yyyy-mm-dd (i.e. startDate~endDate)
         // or yyyy-mm-dd if not sold.
         var start;
         var end;
         if (date.length > 10) {
            start = date.substring(0,10);
            end = date.substring(11,20);
         } else {
            start = new Date(date);
            end = new Date($scope.tday);
            end.setDate(end.getDate() - 1);
         }
         $scope.shareDates[code] = [start, end];

         // Prepare the code format for the URL by combining
         // all the stock codes together in one string
         if (i == 0) {
            codeString = codeString + "%22" + code;
         } else {
            codeString = codeString + "%22%2C%20%22" + code;
         }
         i += 1;

      });

      var yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);

      // Get the data if the portfolio has been up for at least a day and has at least one stock
      if (codeString != "" && (new Date($scope.birthday)).getTime() < yesterday.getTime() && $scope.user)  {
         codeString = codeString + "%22";


         // Construct the URL getting all the shares historical prices between the start date and today
         var url = "https://query.yahooapis.com/v1/public/yql?q=select%20Symbol%2C%20Date%2C%20Close" +
                   "%20from%20yahoo.finance.historicaldata%20where%20symbol%20IN%20(" + codeString +
                   ")%20and%20startDate%20%3D%20%22" + $scope.firstTradeDate +
                  "%22%20and%20endDate%20%3D%20%22" + $scope.tday +
                  "%22&format=json&diagnostics=true&env=store%3A%2F%2Fdatatables.org%2Falltableswithkeys&callback=";

         $http({method: 'GET', url: url, cache: $templateCache}).then(function(response) {
            if (response.data && response.data.query && response.data.query.results && response.data.query.results.quote) {
               $scope.historicalStatus = response.status;
               $scope.historicalDataQuote = response.data.query.results.quote;

               // Get the total value in shares for each day
               $scope.dayShareValue = {};
               $scope.cashValue = {};

               // We want the total value of stocks for each day
               // Therefore for each share we need the amount of shares owned at that date * price at that date
               angular.forEach($scope.shareDates, function (dates, code) {
                  // Initially curDate is the start date
                  var curDate = new Date(dates[0]);

                  // While curDate is less than or equal to the endDate
                  // increment the total price for that date
                  var fridayPrice = 0;
                  while (curDate < new Date(dates[1]).getTime()) {
                     if (!$scope.dayShareValue[curDate.getTime()]) {
                        $scope.dayShareValue[curDate.getTime()] = 0;
                     }
                     var quantity = $scope.getNumSharesOwned(code, curDate);
                     var price = 0;
                     if (curDate.getDay() % 6 != 0) {
                        price = $scope.getSharePriceAtDate(code, curDate);
                        if (curDate.getDay() == 5) {
                           fridayPrice = price;
                        }
                     } else if (curDate.getDay() == 6) { //Saturday
                        price = fridayPrice;
                     } else { //Sunday
                        price = fridayPrice;
                     }

                     // Add the share value worth to the dict
                     $scope.dayShareValue[curDate.getTime()] += quantity * price;
                     // Add the cash held to the cash dict.
                     var cash = $scope.getCashHistory(code, curDate);
                     if (cash > -1) {
                        $scope.cashValue[curDate.getTime()] = cash;
                     } else {
                        // If there are no transactions for that date
                        // cash held is yesterdays cash
                        var tempDate = new Date(curDate)
                        tempDate.setDate(curDate.getDate() - 1);
                        $scope.cashValue[curDate.getTime()] = $scope.cashValue[tempDate.getTime()];

                     }
                     curDate.setDate(curDate.getDate() + 1);
                  }
               });

               // Sort the dates in ascending order
               var keys = [];

               for(var key in $scope.dayShareValue) {
                  if($scope.dayShareValue.hasOwnProperty(key)) {
                     keys.push(key);
                     $scope.dayShareValue[key] += $scope.cashValue[key];
                  }
               }
               keys.sort(function(a, b){return a-b});

               // Set up the chart prices in the correct format
               // for high charts
               var chartPrices = [];
               for (var i = 0; i < keys.length; i++) {
                  var date = keys[i];
                  var price = $scope.dayShareValue[date];
                  var currentList = chartPrices;
                  var newList = currentList.concat([[parseInt(date), parseFloat(price.toFixed(2))]]);
                  chartPrices = newList;
               }

               // Draw the chart
               $scope.drawPortfolioChart(chartPrices);
            } else {
               // With the user having no transaction history or only having
               // transaction history for one day - just return their total
               // portfolio value for each day
               var chartPrices = $scope.getPortfolioValue();
               $scope.drawPortfolioChart(chartPrices);
            }
         });
      } else {
         // With the user having no transaction history or only having
         // transaction history for one day - just return their total
         // portfolio value for each day
         var chartPrices = $scope.getPortfolioValue();
         $scope.drawPortfolioChart(chartPrices);
      }
   }



   // Cancels the order specified by orderKey
   $scope.cancelOrder = function(orderKey) {
      OrderFactory.delete({'key': orderKey}, function(response) {
         // Successfully deleted. Refresh information on page
         $timeout(function() {
            $scope.getPortfolio();
         }, 250);
         $scope.status = "Order deleted"
      }, function(response) {
         $timeout(function() {
            $scope.getPortfolio();
         }, 250);
         $scope.status = "Failed to delete order. The order may have already been executed."
      });
   };

   // Modal to handle cancelling a pending order
   $scope.openCancelOrder = function (orderKey) {
         $scope.orderKey = orderKey;
         var modalInstance = $modal.open({
            animation: true,
            templateUrl: '/app/partials/cancel.html',
            controller: 'CancelController',
            scope: $scope
         });

         modalInstance.result.then(function (orderKey) {
            $scope.cancelOrder(orderKey)
            ngToast.create({
               content: "Order cancelled!",
               className: "success",
               dismissButton: true,
               dismissOnClick: false,
               dismissOnTimeout: true,
               timeout: 1500
            });
         });
   };

   // Modal to handle selling a stock you currently own
   $scope.openOrderForm = function (code) {
         $scope.sellingFromPortfolio = true;
         $scope.sellCode = code;
         var modalInstance = $modal.open({
            animation: true,
            templateUrl: '/app/partials/orderform.html',
            controller: 'FormController',
            scope: $scope
         });

         modalInstance.result.then(function (status) {
            $scope.sellingFromPortfolio = false;
            $timeout(function() {
               $scope.getPortfolio();
            }, 250);
         });
   };

   // Close the modal
   $scope.cancel = function () {
      $modalInstance.dismiss();
   };

   // Gets user information to populate the portfolio
   if (data.success) {
      $scope.loggedIn = true;
      $scope.user = data.response;
      $scope.codes = $scope.user.codes;
      $scope.holdings = $scope.user.holdings;
      $scope.transHistory = $scope.user.history;
      $scope.birthday = $scope.user.birthday;
      $scope.getPortfolioChart();
   } else {
      $scope.loggedIn = false;
   }
}]);


riskControllers.controller('CancelController', ['$scope', '$modalInstance',
   function($scope, $modalInstance) {
   // Modal to handle confirming an order cancellation
   $scope.cancelOrder = function(orderKey) {
      $modalInstance.close(orderKey);
   }

   // Close the modal
   $scope.cancel = function () {
      $modalInstance.dismiss();
   };
}]);


// Welcome controller
riskControllers.controller('WelcomeController', ['$scope', '$http', 'UserFactory', function($scope, $http, UserFactory) {
   $scope.navModalsLR = ['Login', 'Register'];
   UserFactory.get({'email':true, 'nickname':true}, function(response) {
      $scope.email = response.email;
      $scope.nickname = response.nickname;
      $scope.loggedIn = true;
   }, function(error) {
      $scope.loggedIn = false;
   });
}]);


// Login controller
riskControllers.controller('LoginController', ['$scope', '$http', '$window', 'UserFactory', 'AccountFactory', '$modalInstance', function($scope, $http, $window, UserFactory, AccountFactory, $modalInstance) {
   // Initialise user
   $scope.user = {
      email: "",
      password: ""
   };

   UserFactory.get({'email':true, 'nickname':true}, function(response) {
      $scope.email = response.email;
      $scope.nickname = response.nickname;
      $scope.loggedIn = true;
   }, function(response) {
      $scope.loggedIn = false;
   });

   $scope.validateUser = function() {
      // TODO Think about how to do this without sending pass in clear
      AccountFactory.save({'login':true, 'request': angular.toJson($scope.user)}, function(response) {
         $modalInstance.close();
      }, function() {
         $scope.message = "Incorrect username or password";
      });
   }

   // Close the modal
   $scope.cancel = function () {
      $modalInstance.dismiss();
   };
}]);

// Logout confirmation controller
riskControllers.controller('LogoutController', ['$scope','$modalInstance', function($scope, $modalInstance) {
   $scope.cancel = function() {
      $modalInstance.dismiss();
   }
}]);

riskControllers.controller('SignupController', ['$scope', '$http', 'AccountFactory', '$modalInstance', function($scope, $http, AccountFactory, $modalInstance) {
   $scope.addUser = function() {
      if($scope.user.password != $scope.user.password_again) {
         $scope.message = "Please ensure passwords match";
      } else {
         AccountFactory.save({'signup':true, 'request': angular.toJson($scope.user)}, function(response) {
            $modalInstance.close();
         }, function(){
            $scope.message = "A user with this email already exists!";
         });
      }
   }

   // Close the modal
   $scope.cancel = function () {
      $modalInstance.dismiss();
   };
}]);

riskControllers.controller('ResetController', ['$scope', '$http', '$modalInstance', 'UserFactory', 'AccountFactory', 'ngToast', function($scope, $http, $modalInstance, UserFactory, AccountFactory, ngToast) {
   // Initialise user
   $scope.user = {
      email: "",
      password: ""
   };

   UserFactory.get({'email':true, 'nickname':true}, function(response){
      $scope.email = response.email;
      $scope.nickname = response.nickname;
      $scope.loggedIn = true;
   }, function(response) {
      $scope.loggedIn = false;
   });

   $scope.changeLogin = function() {
      var checkLogin = {
         'email'   : $scope.email,
         'password': $scope.pass.new1,
         'old_pass': $scope.pass.old
      };

      if ($scope.pass.new1 != $scope.pass.new2) {
         $scope.message = "Please ensure new passwords match";
      } else if ($scope.pass.new1 && $scope.email && $scope.pass.old) {
         AccountFactory.save({'reset':true, 'request': angular.toJson(checkLogin)}, function(response) {
            $scope.message = "Password changed successfully!";
            ngToast.create({
               content: "Password succesfully changed!",
               className: "success",
               dismissButton: true,
               dismissOnClick: false,
               dismissOnTimeout: true,
               timeout: 1500
            });
            $modalInstance.close();
         }, function(){
            $scope.message = "Something went wrong in password update - check old password";
         });
      } else {
         $scope.message = "Something went wrong in password update - check old password";
      }
   }

   // Close the modal
   $scope.cancel = function () {
      $modalInstance.dismiss();
   };
}]);

// Handles the confirmation window modal
riskControllers.controller('OrderController', ['$scope', '$log', '$modalInstance', '$q', 'UserFactory', 'OrderFactory', '$modalStack', 'ngToast', function ($scope, $log, $modalInstance, $q, UserFactory, OrderFactory, $modalStack, ngToast) {
   // Close the modal
   $scope.cancel = function () {
      $modalInstance.dismiss();
   };

   // A function to validate the order form. The order form must be
   // valid for an order to progress. Provides a promise to ensure
   // the request is synchronous
   $scope.validate = function(){
      var valid = false;
      var deferred = $q.defer();

      // Get user information
      UserFactory.get({'cash':true, 'sellable_shares':true}, function(response){
         $scope.userCash = response.cash;
         $scope.sellableShares = response.sellable_shares;

         // Further validation (modal handles formatting validation
         if ($scope.order.type == "buy"
            && $scope.userCash >= $scope.order.price * $scope.order.quantity + 20) {
            deferred.resolve("Order Successful!");
         } else if ($scope.order.type == "buy") {
            deferred.reject("You do not have enough money to purchase that amount of shares!");
         } else if ($scope.order.type == "sell" &&
            parseFloat($scope.sellableShares[$scope.order.stock]) >= $scope.order.quantity) {
            deferred.resolve("Order Successful!");
         } else if ($scope.order.type == "sell") {
            deferred.reject("You are trying to sell more shares than you own!");
         }
      }, function() {
         deferred.reject("Order Failed! Please try again");
      });
      return deferred.promise;
   }


   // Handle when the submit button is pressed to send an order request
   // Changes status according to success or failure
   $scope.addOrder = function(){
      $scope.submitted = true;

      // The order request is only processed if valid.
      var validated = $scope.validate();
      validated.then(function(resolve) {

         // Process the order for the corresponding user account
         UserFactory.get({'email':true}, function(response){
            $scope.order.email = response.email;

            // Hack to keep price on order_confirmation the same (TODO fix)
            $scope.tempPrice = $scope.order.price;

            // Don't execute order immediately. Every 5 minutes orders will be executed by cron
            $scope.order.executed = false;

            // Send the order and give a message if successful
            OrderFactory.save({'order':angular.toJson($scope.order)}, function(response) {
               $scope.status = resolve;
               $modalInstance.close($scope.status);
            }, function(){
               $scope.status = "Order Failed! Please try again";
               $modalInstance.close($scope.status);
            });

            // Hack to keep price on order_confirmation the same (TODO fix)
            $scope.order.price = $scope.tempPrice;

         }, function(response) {
            $scope.status = "Order Failed! Please try again";
            $modalStack.dismissAll($scope.status);
         });
      }, function(reject){
         $scope.status = reject;
         ngToast.create({
            content: "<strong>Error:</strong> " + $scope.status,
            className: "danger",
            dismissButton: true,
            dismissOnClick: true,
            dismissOnTimeout: false
         });
      });
   };
}]);

// Historical transactions controller
riskControllers.controller('HistoryController', ['$scope', 'data', 'UserFactory', 'ngToast', function($scope, data, UserFactory, ngToast) {
   if (data.success) {
      $scope.loggedIn = true;
      $scope.transactions = data.response.history;
   } else {
      $scope.loggedIn = false;
   }

   // Used on the history page to determine whether there are any transactions
   // to display
   $scope.Object = Object;
   $scope.objectSize = function(object) {
      if (object) {
         return Object.keys(object).length;
      } else {
         return 0;
      }
   }

   $scope.refresh = function() {
      UserFactory.get({'history': true}, function(response) {
         $scope.transactions = response.history;
         ngToast.create({
            content: "Page refreshed!",
            className: "info",
            dismissButton: true,
            dismissOnClick: false,
            dismissOnTimeout: true,
            timeout: 1500
         });
      }, function(error) {
         ngToast.create({
            content: "Error refreshing page. Try again.",
            className: "error",
            dismissButton: true,
            dismissOnClick: false,
            dismissOnTimeout: true,
            timeout: 1500
         });
      });
   }
}]);

// Leaderboard controller
riskControllers.controller('LeaderboardController', ['$scope', 'userData', 'ngToast', 'UserFactory', function($scope, userData, ngToast, UserFactory) {
   $scope.getLeaderboard = function() {
      UserFactory.get({'leaderboard': true}, function(response) {
         $scope.players = response.leaderboard;
         $scope.list = [];
         // Put all the information in the list and then sort it based on total value (index 6)
         for (var email in $scope.players) {
            $scope.list.push([ email, $scope.players[email][0], $scope.players[email][1], $scope.players[email][2], $scope.players[email][3], $scope.players[email][4], $scope.players[email][5]]);
         };
         $scope.list.sort(function(a, b) {return b[6] - a[6]});
         // Add ranks to the sorted list
         var i = 0;
         angular.forEach($scope.list,function(elm,index){
            elm.push(index + 1); // Their rank is their index + 1 (since indices start at 0)
         });
      }, function(response) {

      });
   }

   if (userData.success) {
      $scope.loggedIn = true;
      $scope.user = userData.response;
      $scope.getLeaderboard();
   } else {
      $scope.loggedIn = false;
   }

   $scope.refresh = function() {
      $scope.getLeaderboard();
      ngToast.create({
         content: "Page refreshed!",
         className: "info",
         dismissButton: true,
         dismissOnClick: false,
         dismissOnTimeout: true,
         timeout: 1500
      });
   }
}]);


// Handles modals for login and signup
riskControllers.controller('NavController', ['$scope', '$modal', '$route', '$location', function($scope, $modal, $route, $location) {
   var hour = new Date().getUTCHours();
   var day = new Date().getUTCDay();
   // Make sure it is a weekday (between 11pm (23) on Sunday (0) and 5am (5) on Friday (5) in UTC time).
   if ((day == 0 && hour < 23) || (day >= 5 && hour > 5)) {
      // Weekend
      $scope.marketOpen = false;
   } else {
      // Weekday
      // In UTC time, the market is open from 11pm (23) to 5am (5).
      if (hour < 23 && hour > 5) {
         $scope.marketOpen = false;
      } else {
         $scope.marketOpen = true;
      }
   }

   $scope.navModals = ['Account', 'Logout'];
   $scope.navPills = [{
         label: 'Home',
         class: '',
         href: '/#/'
      },
      {
         label: 'Trade',
         class: '',
         href: '/#/trade'
      },
      {
         label: 'Portfolio',
         class: '',
         href: '/#/portfolio'
      },
      {
         label: 'History',
         class: '',
         href: '/#/history'
      },
      {
         label: 'Leaderboard',
         class: '',
         href: '/#/leaderboard'
      }
   ];

   // Make the pill corresponding to the current index active
   $scope.updateNav = function(index) {
      for (var i = 0; i < $scope.navPills.length; i++) {
         if (i == parseFloat(index)) {
            $scope.navPills[i].class = 'active';
         } else {
            $scope.navPills[i].class = '';
         }
      }
   }

   // Open the corresponding modals to handle user accounts
   $scope.openModal = function(label) {
      if (label == 'Login') {
         var templateUrl = '/app/partials/login.html';
         var controller = 'LoginController';
      } else if (label == 'Register') {
         var templateUrl = '/app/partials/signup.html';
         var controller = 'SignupController';
      } else if (label == 'Account') {
         var templateUrl = '/app/partials/reset.html';
         var controller = 'ResetController';
      } else if (label == 'Logout') {
         var templateUrl = '/app/partials/logout.html';
         var controller = 'LogoutController';
      }
      var modalInstance = $modal.open({
         animation: true,
         templateUrl: templateUrl,
         controller: controller
      });

      modalInstance.result.then(function () {
         $route.reload();
      });
   }

   $scope.locationPath = function (newLocation) {
      return $location.path(newLocation);
   };
}]);