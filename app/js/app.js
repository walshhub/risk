'use strict';

var riskApp = angular.module('riskApp', [
   'ngRoute',
   'ngResource',
   'riskControllers',
   'ui.bootstrap',
   'highcharts-ng',
   'ngToast',
   'ngAnimate'
]);

riskApp.config(['ngToastProvider', function(ngToast) {
   ngToast.configure({
      horizontalPosition: "center",
      verticalPosition: "top",
      maxNumber: 1,
      animation: "slide"
      // additionalClasses: "custom"
   });
}]);

riskApp.config(['$routeProvider', function($routeProvider) {
   $routeProvider.
      when('/', {
         controller : 'WelcomeController',
         templateUrl: '/app/partials/welcome.html'
      })
      .when('/trade', {
         controller : 'QuoteController',
         templateUrl: '/app/partials/form.html',
         resolve    : {
            user: function(UserFactory, $q) {
               var dfd = $q.defer();
               UserFactory.get({'email': true}, function(result) {
                  dfd.resolve({ success: true, response : result });
                }, function(error) {
                  dfd.resolve({ success : false, response : error });
                });
               return dfd.promise;
            }
         }
      })
      .when('/welcome', {
         controller : 'WelcomeController',
         templateUrl: '/app/partials/welcome.html'
      })
      .when('/portfolio', {
         controller : 'PortfolioController',
         templateUrl: '/app/partials/portfolio.html',
         resolve    : {
            data: function(UserFactory, $q) {
               var dfd = $q.defer();
               UserFactory.get({'cash':true, 'share':true, 'pending':true, 'holdings':true, 'codes':true, 'history':true, 'birthday':true}, function(result) {
                  dfd.resolve({ success: true, response : result });
                }, function(error) {
                  dfd.resolve({ success : false, response : error });
                });
               return dfd.promise;
            }
         }
      })
      .when('/reset', {
         controller : 'ResetController',
         templateUrl: '/app/partials/reset.html'
      })
      .when('/login', {
         controller : 'LoginController',
         templateUrl: '/app/partials/login.html'
      })
      .when('/signup', {
         controller : 'SignupController',
         templateUrl: '/app/partials/signup.html'
      })
      .when('/history', {
         controller : 'HistoryController',
         templateUrl: '/app/partials/history.html',
         resolve    : {
            data: function(UserFactory, $q) {
               var dfd = $q.defer();
               UserFactory.get({'history': true}, function(result) {
                  dfd.resolve({ success: true, response : result });
                }, function(error) {
                  dfd.resolve({ success : false, response : error });
                });
               return dfd.promise;
            }
         }
      })
      .when('/leaderboard', {
         controller : 'LeaderboardController',
         templateUrl: '/app/partials/leaderboard.html',
         resolve    : {
            userData: function(UserFactory, $q) {
               var dfd = $q.defer();
               UserFactory.get({'email': true}, function(result) {
                  dfd.resolve({ success: true, response : result });
                }, function(error) {
                  dfd.resolve({ success : false, response : error });
                });
               return dfd.promise;
            }
         }
      });
  }
]);

// Directive for the navbar
riskApp.directive('navBar', function() {
   return {
      restrict: 'E',
      scope: {
         links: '=links',
         pills: '=pills',
         modals: '=modals'
      },
      templateUrl: '/app/directives/nav-bar.html'
   };
});

// Directive for smoothscroll
riskApp.directive('smoothScroll', [
  '$log', '$timeout', '$window', function($log, $timeout, $window) {
    /*
        Retrieve the current vertical position
        @returns Current vertical position
    */

    var currentYPosition, elmYPosition, smoothScroll;
    currentYPosition = function() {
      if ($window.pageYOffset) {
        return $window.pageYOffset;
      }
      if ($window.document.documentElement && $window.document.documentElement.scrollTop) {
        return $window.document.documentElement.scrollTop;
      }
      if ($window.document.body.scrollTop) {
        return $window.document.body.scrollTop;
      }
      return 0;
    };
    /*
        Get the vertical position of a DOM element
        @param eID The DOM element id
        @returns The vertical position of element with id eID
    */

    elmYPosition = function(eID) {
      var elm, node, y;
      elm = document.getElementById(eID);
      if (elm) {
        y = elm.offsetTop;
        node = elm;
        while (node.offsetParent && node.offsetParent !== document.body) {
          node = node.offsetParent;
          y += node.offsetTop;
        }
        return y;
      }
      return 0;
    };
    /*
        Smooth scroll to element with a specific ID without offset
        @param eID The element id to scroll to
        @param offSet Scrolling offset
    */

    smoothScroll = function(eID, offSet) {
      var distance, i, leapY, speed, startY, step, stopY, timer, _results;
      startY = currentYPosition();
      stopY = elmYPosition(eID) - offSet;
      distance = (stopY > startY ? stopY - startY : startY - stopY);
      if (distance < 100) {
        scrollTo(0, stopY);
        return;
      }
      speed = Math.round(distance / 100);
      if (speed >= 20) {
        speed = 20;
      }
      step = Math.round(distance / 25);
      leapY = (stopY > startY ? startY + step : startY - step);
      timer = 0;
      if (stopY > startY) {
        i = startY;
        while (i < stopY) {
          setTimeout('window.scrollTo(0, ' + leapY + ')', timer * speed);
          leapY += step;
          if (leapY > stopY) {
            leapY = stopY;
          }
          timer++;
          i += step;
        }
        return;
      }
      i = startY;
      _results = [];
      while (i > stopY) {
        setTimeout('window.scrollTo(0, ' + leapY + ')', timer * speed);
        leapY -= step;
        if (leapY < stopY) {
          leapY = stopY;
        }
        timer++;
        _results.push(i -= step);
      }
      return _results;
    };
    return {
      restrict: 'A',
      link: function(scope, element, attr) {
        return element.bind('click', function() {
          var offset;
          if (attr.target) {
            offset = attr.offset || 100;
            $log.log('Smooth scroll: scrolling to', attr.target, 'with offset', offset);
            return smoothScroll(attr.target, offset);
          } else {
            return $log.warn('Smooth scroll: no target specified');
          }
        });
      }
    };
  }
]);

// Factory which handles all information relevant to the user
riskApp.factory('UserFactory', ['$resource', function($resource) {
   return $resource('/user');
}]);

// Factory which handles all information relevant to orders and transactions
riskApp.factory('OrderFactory', ['$resource', function($resource) {
   return $resource('/order');
}]);

// Factory which handles all information relevant to accounts
riskApp.factory('AccountFactory', ['$resource', function($resource) {
   return $resource('/account');
}]);
