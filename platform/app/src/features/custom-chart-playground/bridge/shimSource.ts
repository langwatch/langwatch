/**
 * The frame-side shim, as a string of plain JavaScript.
 *
 * A string rather than a module because it executes inside a sandboxed
 * `srcdoc` iframe: `buildSrcdoc` inlines it as the document's first executed
 * script, ahead of the CDN-loaded React/ReactDOM/Recharts/Babel globals and
 * the author runtime that compiles and mounts the widget's file. It installs
 * the `LW` global, forwards console output and uncaught errors to the
 * parent, posts a heartbeat, and — the init-race fix — calls
 * `window.__lwActivateAuthor` only AFTER `lw:init` has delivered the port,
 * params and theme, so author code can read `LW.params` synchronously at its
 * first line.
 *
 * The shim itself knows nothing about Babel or the module format — that
 * lives in `bridge/authorRuntime.ts`, which is what defines the hook this
 * file calls. It does know about React for exactly one thing:
 * `LW.useChartQuery`, a hook wrapping `LW.query`'s promise in
 * `window.React.useState`/`useEffect` (React is CDN-loaded ahead of this
 * script — see `buildSrcdoc`). A future non-React chart kind can still reuse
 * everything else in this file unchanged and simply not call that hook.
 *
 * Protocol constants are interpolated from `bridgeProtocol.ts` so the two
 * sides cannot drift.
 */

import {
  CHART_FRAME_HEARTBEAT_INTERVAL_MS,
  CHART_FRAME_MAX_HEIGHT_PX,
  CHART_FRAME_MIN_HEIGHT_PX,
} from "./bridgeProtocol";

export function buildShimScript(): string {
  return `
(function () {
  "use strict";

  var port = null;
  var buffered = [];
  var nextRequestId = 1;
  var pending = {};
  var paramsCallbacks = [];
  var resolveReady;
  var ready = new Promise(function (resolve) { resolveReady = resolve; });

  function post(message) {
    if (port) { port.postMessage(message); } else { buffered.push(message); }
  }

  function stringify(value) {
    if (typeof value === "string") return value;
    try {
      var seen = [];
      return JSON.stringify(value, function (_key, v) {
        if (typeof v === "object" && v !== null) {
          if (seen.indexOf(v) !== -1) return "[circular]";
          seen.push(v);
        }
        if (typeof v === "function") return "[function]";
        if (typeof v === "undefined") return "[undefined]";
        return v;
      });
    } catch (_error) {
      return String(value);
    }
  }

  function messageOf(value) {
    if (value && typeof value === "object" && typeof value.message === "string") {
      return (value.name ? value.name + ": " : "") + value.message;
    }
    return stringify(value);
  }

  var LW = {
    params: undefined,
    theme: undefined,
    query: function (name, params) {
      return ready.then(function () {
        return new Promise(function (resolve, reject) {
          if (typeof name !== "string" || !name) {
            reject({ code: "invalid_query_name", title: "Invalid query", message: "LW.query's first argument must be the query's name, a non-empty string." });
            return;
          }
          var requestId = nextRequestId++;
          pending[requestId] = { resolve: resolve, reject: reject };
          post({ type: "lw:query", requestId: requestId, queryName: name, params: params || {} });
        });
      });
    },
    setHeight: function (px) {
      var clamped = Math.max(${CHART_FRAME_MIN_HEIGHT_PX}, Math.min(${CHART_FRAME_MAX_HEIGHT_PX}, Number(px) || ${CHART_FRAME_MIN_HEIGHT_PX}));
      post({ type: "lw:set-height", px: clamped });
    },
    // Returns an unsubscribe function — useChartQuery below relies on this to
    // drop its listener on cleanup instead of accumulating one per mount.
    onParamsChange: function (callback) {
      var removed = false;
      ready.then(function () {
        if (!removed) paramsCallbacks.push(callback);
      });
      return function () {
        removed = true;
        var index = paramsCallbacks.indexOf(callback);
        if (index !== -1) paramsCallbacks.splice(index, 1);
      };
    },
    error: function (err) {
      post({ type: "lw:error", source: "lw.error", message: messageOf(err) });
    }
  };
  window.LW = LW;

  function chartQueryErrorMessage(err) {
    if (err && typeof err === "object") {
      var title = typeof err.title === "string" ? err.title : null;
      var msg = typeof err.message === "string" ? err.message : null;
      if (title && msg) return title + ": " + msg;
      if (msg) return msg;
      if (title) return title;
    }
    return messageOf(err);
  }

  /**
   * The recommended way for widget code to fetch: wraps LW.query so authors
   * never hand-roll the promise/useEffect/useState dance. Three footguns it
   * closes that a naive Promise.all/.then would not:
   *  - a rejection (undeclared param, SQL error, timeout) lands in 'error' as
   *    a string, never as an uncaught rejection that would white-screen the
   *    frame;
   *  - a resolution arriving after the calling component unmounted (or after
   *    'name'/'params' changed again) is dropped, so there is no
   *    setState-on-unmounted race;
   *  - 'params' is compared by value (JSON), not identity, so an inline
   *    object literal in the widget's JSX does not cause a refetch loop.
   * It also refetches on its own whenever the page-level time window or
   * granularity changes, via the same onParamsChange feed LW.onParamsChange
   * exposes directly - a widget using this hook stays live without its
   * author ever touching that lower-level API.
   */
  LW.useChartQuery = function (name, params) {
    var React = window.React;
    var effectiveParams = params || {};
    var paramsKey = stringify(effectiveParams);
    var stateHook = React.useState({ data: null, loading: true, error: null });
    var state = stateHook[0];
    var setState = stateHook[1];

    React.useEffect(function () {
      var cancelled = false;

      function run() {
        if (cancelled) return;
        setState({ data: null, loading: true, error: null });
        LW.query(name, effectiveParams).then(
          function (result) {
            if (cancelled) return;
            setState({ data: result.rows, loading: false, error: null });
          },
          function (err) {
            if (cancelled) return;
            setState({ data: null, loading: false, error: chartQueryErrorMessage(err) });
          }
        );
      }

      run();
      var unsubscribe = LW.onParamsChange(run);

      return function () {
        cancelled = true;
        unsubscribe();
      };
      // paramsKey stands in for effectiveParams: same dependency semantics,
      // compared by value instead of by (always-new) object identity.
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [name, paramsKey]);

    return state;
  };

  // Console + uncaught-error forwarding, installed before the author's code
  // ever runs so author-time failures are attributed.
  ["log", "info", "warn", "error"].forEach(function (level) {
    var original = console[level].bind(console);
    console[level] = function () {
      var parts = Array.prototype.slice.call(arguments).map(stringify);
      post({ type: "lw:log", level: level, source: "console", parts: parts });
      original.apply(null, arguments);
    };
  });
  window.addEventListener("error", function (event) {
    post({
      type: "lw:error",
      source: "error",
      message: (event.message || "uncaught error") +
        (event.filename ? " (" + event.filename + ":" + event.lineno + ")" : "")
    });
  });
  window.addEventListener("unhandledrejection", function (event) {
    post({ type: "lw:error", source: "unhandledrejection", message: messageOf(event.reason) });
  });

  function onPortMessage(event) {
    var data = event.data || {};
    if (data.type === "lw:query-result") {
      var entry = pending[data.requestId];
      if (entry) { delete pending[data.requestId]; entry.resolve(data.result); }
    } else if (data.type === "lw:query-error") {
      var failed = pending[data.requestId];
      if (failed) { delete pending[data.requestId]; failed.reject(data.error); }
    } else if (data.type === "lw:params-change") {
      LW.params = data.params;
      paramsCallbacks.forEach(function (callback) {
        try { callback(data.params); } catch (callbackError) { LW.error(callbackError); }
      });
    }
  }

  // The activation hook itself is generic — the shim knows nothing about
  // templates, React or Babel. buildSrcdoc defines window.__lwActivateAuthor
  // before this script runs; whatever runtime it wires up (today: the
  // author-runtime that compiles and mounts a React file) is what actually
  // runs the author's code.
  function activateAuthor() {
    if (typeof window.__lwActivateAuthor === "function") {
      try {
        window.__lwActivateAuthor();
      } catch (activationError) {
        LW.error(activationError);
      }
    }
  }

  window.addEventListener("message", function (event) {
    var data = event.data || {};
    if (data.type !== "lw:init") return;
    // The transferred port comes from the FIRST init only; later inits ignored.
    if (port || !event.ports || !event.ports[0]) return;
    port = event.ports[0];
    port.onmessage = onPortMessage;
    LW.params = data.params;
    LW.theme = data.theme;
    buffered.forEach(function (message) { port.postMessage(message); });
    buffered = [];
    setInterval(function () {
      port.postMessage({ type: "lw:heartbeat" });
    }, ${CHART_FRAME_HEARTBEAT_INTERVAL_MS});
    resolveReady();
    activateAuthor();
  });
})();
`;
}
