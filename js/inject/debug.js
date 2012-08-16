var inject = function () {
  document.head.appendChild((function () {

    // Helpers
    // =======

    // Based on cycle.js
    // 2011-08-24
    // https://github.com/douglascrockford/JSON-js/blob/master/cycle.js

    // Make a deep copy of an object or array, assuring that there is at most
    // one instance of each object or array in the resulting structure. The
    // duplicate references (which might be forming cycles) are replaced with
    // an object of the form
    //      {$ref: PATH}
    // where the PATH is a JSONPath string that locates the first occurance.
    var decycle = function (object) {
      var objects = [],   // Keep a reference to each unique object or array
          paths = [];     // Keep the path to each unique object or array

      return (function derez(value, path) {
        var i,          // The loop counter
            name,       // Property name
            nu;         // The new object or array
        switch (typeof value) {
        case 'object':
          if (!value) {
            return null;
          }
          for (i = 0; i < objects.length; i += 1) {
            if (objects[i] === value) {
              return {$ref: paths[i]};
            }
          }
          objects.push(value);
          paths.push(path);
          if (Object.prototype.toString.apply(value) === '[object Array]') {
            nu = [];
            for (i = 0; i < value.length; i += 1) {
              nu[i] = derez(value[i], path + '[' + i + ']');
            }
          } else {
            nu = {};
            for (name in value) {
              if (Object.prototype.hasOwnProperty.call(value, name)) {
                nu[name] = derez(value[name],
                  path + '[' + JSON.stringify(name) + ']');
              }
            }
          }
          return nu;
        case 'number':
        case 'string':
        case 'boolean':
          return value;
        }
      }(object, '$'));
    };
    // End
    // ===

    var fn = function bootstrap (window) {

      var angular = window.angular;

      // Helper to determine if the root 'ng' module has been loaded
      // window.angular may be available if the app is bootstrapped asynchronously, but 'ng' might
      // finish loading later.
      var ngLoaded = function () {
        if (!window.angular) {
          return false;
        }
        try {
          window.angular.module('ng');
        }
        catch (e) {
          return false;
        }
        return true;
      };

      if (!ngLoaded()) {
        (function () {
          // TODO: var name
          var areWeThereYet = function (ev) {
            if (ev.srcElement.tagName === 'SCRIPT') {
              var oldOnload = ev.srcElement.onload;
              ev.srcElement.onload = function () {
                if (ngLoaded()) {

                  document.removeEventListener('DOMNodeInserted', areWeThereYet);
                  bootstrap(window);
                }
                if (oldOnload) {
                  oldOnload.apply(this, arguments);
                }
              };
            }
          };
          document.addEventListener('DOMNodeInserted', areWeThereYet);
        }());
        return;
      }

      // do not patch twice
      if (window.__ngDebug) {
        return;
      }

      // Instrumentation
      // ---------------

      //var bootstrap = window.angular.bootstrap;
      var debug = window.__ngDebug = {
        watchers: {}, // map of scopes --> watchers

        watchPerf: {}, // maps of watch/apply exp/fns to perf data
        applyPerf: {},

        scopes: {}, // map of scope.$ids --> scope objects
        rootScopes: [], // array of refs to root scopes

        deps: []
      };


      var getScopeLocals = function (scope) {
        var scopeLocals = {}, prop;
        for (prop in scope) {
          if (scope.hasOwnProperty(prop) && prop !== 'this' && prop[0] !== '$') {
            scopeLocals[prop] = scope[prop];
          }
        }
        return scopeLocals;
      };

      var annotate = angular.injector().annotate;

      // not all versions of AngularJS expose annotate
      if (!annotate) {
        annotate = (function () {

          var FN_ARGS = /^function\s*[^\(]*\(\s*([^\)]*)\)/m;
          var FN_ARG_SPLIT = /,/;
          var FN_ARG = /^\s*(_?)(.+?)\1\s*$/;
          var STRIP_COMMENTS = /((\/\/.*$)|(\/\*[\s\S]*?\*\/))/mg;

          // TODO: should I keep these assertions?
          function assertArg(arg, name, reason) {
            if (!arg) {
              throw new Error("Argument '" + (name || '?') + "' is " + (reason || "required"));
            }
            return arg;
          }
          function assertArgFn(arg, name, acceptArrayAnnotation) {
            if (acceptArrayAnnotation && angular.isArray(arg)) {
                arg = arg[arg.length - 1];
            }

            assertArg(angular.isFunction(arg), name, 'not a function, got ' +
                (arg && typeof arg == 'object' ? arg.constructor.name || 'Object' : typeof arg));
            return arg;
          }

          return function (fn) {
            var $inject,
                fnText,
                argDecl,
                last;

            if (typeof fn == 'function') {
              if (!($inject = fn.$inject)) {
                $inject = [];
                fnText = fn.toString().replace(STRIP_COMMENTS, '');
                argDecl = fnText.match(FN_ARGS);
                argDecl[1].split(FN_ARG_SPLIT).forEach(function(arg) {
                  arg.replace(FN_ARG, function(all, underscore, name) {
                    $inject.push(name);
                  });
                });
                fn.$inject = $inject;
              }
            } else if (angular.isArray(fn)) {
              last = fn.length - 1;
              assertArgFn(fn[last], 'fn')
              $inject = fn.slice(0, last);
            } else {
              assertArgFn(fn, 'fn', true);
            }
            return $inject;
          };
        }());
      }

      var ng = angular.module('ng');
      ng.config(function ($provide) {
        // methods to patch
        [
          'provider',
          'factory',
          'service'
        ].forEach(function (met) {
          var temp = $provide[met];
          $provide[met] = function (thingName, definition) {
            debug.deps.push({
              name: thingName,
              imports: annotate(definition)
            });
            return temp.apply(this, arguments);
          };
        });

        $provide.decorator('$rootScope', function ($delegate) {
          
          var watchFnToHumanReadableString = function (fn) {
            if (fn.exp) {
              return fn.exp.trim();
            } else if (fn.name) {
              return fn.name.trim();
            } else {
              return fn.toString();
            }
          };

          var applyFnToLogString = function (fn) {
            var str;
            if (fn) {
              if (fn.name) {
                str = fn.name;
              } else if (fn.toString().split('\n').length > 1) {
                str = 'fn () { ' + fn.toString().split('\n')[1].trim() + ' /* ... */ }';
              } else {
                str = fn.toString().trim().substr(0, 30) + '...';
              }
            } else {
              str = '$apply';
            }
            return str;
          };


          // patch registering watchers
          // ==========================

          var _watch = $delegate.__proto__.$watch;
          $delegate.__proto__.$watch = function(watchExpression, applyFunction) {
            var thatScope = this;
            var watchStr = watchFnToHumanReadableString(watchExpression);
            
            if (!debug.watchPerf[watchStr]) {
              debug.watchPerf[watchStr] = {
                time: 0,
                calls: 0
              };
            }

            // patch watchExpression
            // ---------------------

            var w = watchExpression;
            if (typeof w === 'function') {
              watchExpression = function () {
                var start = window.performance.webkitNow();
                var ret = w.apply(this, arguments);
                var end = window.performance.webkitNow();
                debug.watchPerf[watchStr].time += (end - start);
                debug.watchPerf[watchStr].calls += 1;
                return ret;
              };
            } else {
              var thatScope = this;
              watchExpression = function () {
                var start = window.performance.webkitNow();
                var ret = thatScope.$eval(w);
                var end = window.performance.webkitNow();
                debug.watchPerf[watchStr].time += (end - start);
                debug.watchPerf[watchStr].calls += 1;
                return ret;
              };
            }

            // patch applyFunction
            // -------------------
            if (applyFunction) {
              var applyStr = applyFunction.toString();
              var unpatchedApplyFunction = applyFunction;
              applyFunction = function () {
                var start = window.performance.webkitNow();
                var ret = unpatchedApplyFunction.apply(this, arguments);
                var end = window.performance.webkitNow();

                debug.scopes[thatScope.$id] = getScopeLocals(thatScope)
                //TODO: move these checks out of here and into registering the watcher
                if (!debug.applyPerf[applyStr]) {
                  debug.applyPerf[applyStr] = {
                    time: 0,
                    calls: 0
                  };
                }
                debug.applyPerf[applyStr].time += (end - start);
                debug.applyPerf[applyStr].calls += (end - start);
                return ret;
              };
            }

            return _watch.apply(this, arguments);
          };


          // patch destroy
          // -------------

          var _destroy = $delegate.__proto__.$destroy;
          $delegate.__proto__.$destroy = function () {
            if (debug.watchers[this.$id]) {
              delete debug.watchers[this.$id];
              delete debug.scopes[this.$id];
            }
            return _destroy.apply(this, arguments);
          };

          var _new = $delegate.__proto__.$new;
          $delegate.__proto__.$new = function () {
            var ret = _new.apply(this, arguments);

            // create empty watchers array for this scope
            if (!debug.watchers[ret.$id]) {
              debug.watchers[ret.$id] = [];
            }

            return ret;
          }

          // patch apply
          // -----------
          var _apply = $delegate.__proto__.$apply;
          $delegate.__proto__.$apply = function (fn) {
            var start = window.performance.webkitNow();
            var ret = _apply.apply(this, arguments);
            var end = window.performance.webkitNow();

            // If the debugging option is enabled, log to console
            // --------------------------------------------------
            if (debug.log) {
              console.log(applyFnToLogString(fn) + '\t\t' + (end - start).toPrecision(4) + 'ms');
            }

            return ret;
          };


          return $delegate;
        });
      });
    };

    // Return a script element with the above code embedded in it
    var script = window.document.createElement('script');
    script.innerHTML = '(' + fn.toString() + '(window))';
    
    return script;
  }()));
};

// only inject if cookie is set
if (document.cookie.indexOf('__ngDebug=true') != -1) {
  document.addEventListener('DOMContentLoaded', inject);
}
