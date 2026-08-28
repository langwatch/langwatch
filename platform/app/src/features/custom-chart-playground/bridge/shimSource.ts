/**
 * The frame-side shim, as a string of plain JavaScript.
 *
 * A string rather than a module because it executes inside a sandboxed
 * `srcdoc` iframe with no module graph of its own: `buildSrcdoc` inlines it
 * as the document's only directly-executed script. It installs the `LW`
 * global, forwards console output and uncaught errors to the parent, posts a
 * heartbeat, and — the init-race fix — activates the author's `<template>`
 * only AFTER `lw:init` has delivered the port, params and theme, so author
 * code can read `LW.params` synchronously at its first line.
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
    query: function (overrides) {
      return ready.then(function () {
        return new Promise(function (resolve, reject) {
          var requestId = nextRequestId++;
          pending[requestId] = { resolve: resolve, reject: reject };
          var wire = {};
          if (overrides && overrides.timeWindow) {
            wire.timeWindow = {
              start: Number(overrides.timeWindow.start),
              end: Number(overrides.timeWindow.end)
            };
          }
          if (overrides && overrides.granularitySeconds !== undefined) {
            wire.granularitySeconds = Number(overrides.granularitySeconds);
          }
          post({ type: "lw:query", requestId: requestId, overrides: wire });
        });
      });
    },
    setHeight: function (px) {
      var clamped = Math.max(${CHART_FRAME_MIN_HEIGHT_PX}, Math.min(${CHART_FRAME_MAX_HEIGHT_PX}, Number(px) || ${CHART_FRAME_MIN_HEIGHT_PX}));
      post({ type: "lw:set-height", px: clamped });
    },
    onParamsChange: function (callback) {
      ready.then(function () { paramsCallbacks.push(callback); });
    },
    error: function (err) {
      post({ type: "lw:error", source: "lw.error", message: messageOf(err) });
    }
  };
  window.LW = LW;

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

  function activateAuthorTemplate() {
    var template = document.getElementById("lw-author");
    if (!template || !template.content) return;
    var fragment = template.content.cloneNode(true);
    // Cloned scripts are inert by spec — re-create each one so it executes.
    var inert = fragment.querySelectorAll("script");
    Array.prototype.forEach.call(inert, function (oldScript) {
      var fresh = document.createElement("script");
      Array.prototype.forEach.call(oldScript.attributes, function (attribute) {
        fresh.setAttribute(attribute.name, attribute.value);
      });
      fresh.textContent = oldScript.textContent;
      oldScript.parentNode.replaceChild(fresh, oldScript);
    });
    document.body.appendChild(fragment);
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
    activateAuthorTemplate();
  });
})();
`;
}
