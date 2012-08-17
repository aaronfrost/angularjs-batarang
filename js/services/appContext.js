// Service for doing stuff in the context of the application being debugged
panelApp.factory('appContext', function (chromeExtension) {

  // Private vars
  // ============

  var _debugCache = {},
    _pollListeners = [],
    _pollInterval = 500;

  // TODO: make this private and have it automatically poll?
  var getDebugData = function (callback) {
    chromeExtension.eval(function (window) {
      // Detect whether or not this is an AngularJS app
      if (!window.angular || !window.__ngDebug) {
        return {};
      } else {
        return window.__ngDebug;
      }
    },
    function (data) {
      if (data) {
        _debugCache = data;
      }
      _pollListeners.forEach(function (fn) {
        fn();
      });

      // poll every 500 ms
      setTimeout(getDebugData, _pollInterval);
    });
  };
  getDebugData();

  // Public API
  // ==========
  return {
    // Fix selection of scope
    // https://github.com/angular/angularjs-batarang/issues/6
    executeOnScope: function(scopeId, fn, args, cb) {
      if (typeof args === 'function') {
        cb = args;
        args = {};
      } else if (!args) {
        args = {};
      }
      args.scopeId = scopeId;
      args.fn = fn.toString();

      chromeExtension.eval("function (window, args) {" +
        "var elts = window.document.getElementsByClassName('ng-scope'), i;" +
        "for (i = 0; i < elts.length; i++) {" +
          "(function (elt) {" +
            "var $scope = window.angular.element(elt).scope();" +
            "if ($scope.$id === args.scopeId) {" +
              "(" + args.fn + "($scope, elt, args));" +
            "}" +
          "}(elts[i]));" +
        "}" +
      "}", args, cb);
    },

    // Getters
    // -------

    getHistogram: function () {
      return _debugCache.histogram;
    },

    getListOfRoots: function () {
      return _debugCache.roots;
    },

    getModelTrees: function () {
      return _debugCache.trees;
    },

    getDeps: function () {
      return _debugCache.deps;
    },

    getAngularVersion: function (cb) {
      chromeExtension.eval(function () {
        return window.angular.version.full +
          ' ' +
          window.angular.version.codeName;
      }, cb);
    },

    getAngularSrc: function (cb) {
      chromeExtension.eval("function (window, args) {" +
        "if (!window.angular) {" +
          "return 'info';" +
        "}" +
        "var elts = window.angular.element('script[src]');" +
        "var re = /\/angular(-\d+(\.(\d+))+(rc)?)?(\.min)?\.js$/;" +
        "var elt;" +
        "for (i = 0; i < elts.length; i++) {" +
          "elt = elts[i];" +
          "if (re.exec(elt.src)) {" +
            "if (elt.src.indexOf('code.angularjs.org') !== -1) {" +
              "return 'error';" +
            "} else if (elt.src.indexOf('ajax.googleapis.com') !== -1) {" +
              "return 'good';" +
            "} else {" +
              "return 'info';" +
            "}" + 
          "}" +
        "}" +
        "return 'info';" +
      "}", cb);
    },

    // Actions
    // -------

    clearHistogram: function (cb) {
      chromeExtension.eval(function (window) {
        window.__ngDebug.watchExp = {};
      }, cb);
    },
    
    refresh: function (cb) {
      chromeExtension.eval(function (window) {
        window.document.location.reload();
      }, cb);
    },

    inspect: function (scopeId) {
      this.executeOnScope(scopeId, function (scope, elt) {
        inspect(elt);
      });
    },

    // Settings
    // --------

    // takes a bool
    setDebug: function (setting) {
      if (setting) {
        chromeExtension.eval(function (window) {
          window.document.cookie = '__ngDebug=true;';
          window.document.location.reload();
        });
      } else {
        chromeExtension.eval(function (window) {
          window.document.cookie = '__ngDebug=false;';
          window.document.location.reload();
        });
      }
    },

    getDebug: function (cb) {
      chromeExtension.eval(function (window) {
        return document.cookie.indexOf('__ngDebug=true') !== -1;
      }, cb);
    },

    // takes a bool
    setLog: function (setting) {
      setting = !!setting;
      chromeExtension.eval('function (window) {' +
        'window.__ngDebug.log = ' + setting.toString() + ';' +
      '}');
    },

    // takes # of milliseconds
    setPollInterval: function (setting) {
      _pollInterval = setting;
    },

    // Registering events
    // ------------------

    // TODO: depreciate this; only poll from now on?
    // There are some cases where you need to gather data on a once-per-bootstrap basis, for
    // instance getting the version of AngularJS
    
    // TODO: move to chromeExtension?
    watchRefresh: function (cb) {
      var port = chrome.extension.connect();
      port.postMessage({
        action: 'register',
        inspectedTabId: chrome.devtools.inspectedWindow.tabId
      });
      port.onMessage.addListener(function(msg) {
        if (msg === 'refresh') {
          cb();
        }
      });
      port.onDisconnect.addListener(function (a) {
        console.log(a);
      });
    },

    watchPoll: function (fn) {
      _pollListeners.push(fn);
    }

  };
});
