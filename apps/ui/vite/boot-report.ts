/**
 * How each first load ended, sent as a `boot` span from the browser app. Browser tracing
 * starts only after the app booted, so this plain script in <head> is what reports a boot
 * that never draws a page. Spec: specs/ui/boot-report.feature
 */
import { PUBLIC_APP_CONFIG_META_NAME } from "@langwatch/config/public-app-config";
import {
  RUM_SERVICE_NAME,
  RUM_SESSION_HEADER,
  RUM_SESSION_ID_KEY,
  RUM_SESSION_LAST_SEEN_KEY,
  RUM_TRACES_PATH,
  SESSION_INACTIVITY_MS,
} from "@langwatch/react-rum/constants";

import routePatterns from "../src/shell/route-patterns.generated.json" with { type: "json" };

/** Events the splash and the entry module send the report; window events are UI_BOOT_EVENTS. */
export const BOOT_REPORT_EVENTS = {
  /** The entry module started running: every file it imports loaded and evaluated. */
  entry: "lw-boot:entry",
  /** The splash's health probe: `detail` is `{ state: "pending" | "ok" | "failed", ms }`. */
  health: "lw-boot:health",
  /** The splash left because the app drew a page. */
  done: "lw-boot:done",
} as const;

/** A boot still on the loading screen this long after navigation start is a stall. */
export const BOOT_STALL_MS = 8000;

/** The span every report is, and the attribute that says how the boot ended. */
export const BOOT_SPAN_NAME = "boot";
export const ATTR_BOOT_OUTCOME = "langwatch.boot.outcome";

/** The boot recovery's counter in index.html: `stuck,tries`. */
const BOOT_ATTEMPT_KEY = "ui-boot-attempt";

// Plain ES5: it runs before any module and on every browser that opens the page. Each outcome
// is sent once; a sampled session also reports a fast boot, every session reports the rest.
const SCRIPT = `(function () {
  var ROUTES = ${JSON.stringify(routePatterns)};
  var left = false, sent = {}, stalled = false, pendingStall = null;
  var traceId = hex(16);
  var drawn = -1, entry = -1, mounted = -1, health = "not_asked", healthMs = -1;
  var failed = [], chunkFailures = 0, wasHidden = document.visibilityState === "hidden";
  var attemptsAtStart = attempts();
  function now() { return Math.round(performance.now()); }
  function hex(bytes) {
    var out = "", values = new Uint8Array(bytes);
    try { crypto.getRandomValues(values); } catch (e) {
      for (var j = 0; j < bytes; j++) values[j] = Math.floor(Math.random() * 256);
    }
    for (var i = 0; i < bytes; i++) out += (values[i] < 16 ? "0" : "") + values[i].toString(16);
    return out;
  }
  function attempts() {
    try {
      return Number(String(sessionStorage.getItem("${BOOT_ATTEMPT_KEY}") || "0,0").split(",")[1]) || 0;
    } catch (e) { return 0; }
  }
  // The page's public config: whether browser tracing is on, and its session sample ratio.
  function config() {
    // By name: a selector here would make the waiting page read this shell as configured.
    var meta = document.getElementsByName("${PUBLIC_APP_CONFIG_META_NAME}")[0];
    if (!meta) return null;
    try {
      var b64 = String(meta.getAttribute("content")).replace(/-/g, "+").replace(/_/g, "/");
      while (b64.length % 4) b64 += "=";
      var binary = atob(b64), bytes = new Uint8Array(binary.length);
      for (var i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      var parsed = JSON.parse(new TextDecoder().decode(bytes));
      var rum = parsed.rum || {};
      if (rum.enabled !== true) return null;
      return {
        ratio: typeof rum.sampleRatio === "number" ? rum.sampleRatio : 1,
        environment: parsed.process && parsed.process.mode
      };
    } catch (e) { return null; }
  }
  // The same session browser tracing joins later, so a sampled visit is sampled whole.
  function session() {
    try {
      var at = Date.now();
      var last = Number(sessionStorage.getItem("${RUM_SESSION_LAST_SEEN_KEY}") || 0);
      var id = sessionStorage.getItem("${RUM_SESSION_ID_KEY}");
      if (!id || !last || at - last > ${SESSION_INACTIVITY_MS}) id = hex(16);
      sessionStorage.setItem("${RUM_SESSION_ID_KEY}", id);
      sessionStorage.setItem("${RUM_SESSION_LAST_SEEN_KEY}", String(at));
      return id;
    } catch (e) { return ""; }
  }
  function sampled(id, ratio) {
    if (ratio >= 1) return true;
    if (ratio <= 0) return false;
    var draw = id ? parseInt(id.slice(0, 8), 16) / 4294967296 : Math.random();
    return draw < ratio;
  }
  function fileOf(url) {
    var path = String(url || "").split(/[?#]/)[0];
    return path.slice(path.lastIndexOf("/") + 1).slice(0, 80);
  }
  // A CDN prefix ("git-6391517b") names the release; a same-origin page names its entry file.
  function releaseOf(src) {
    if (!src) return "unknown";
    var path = String(src).split(/[?#]/)[0].replace(/^[a-z]+:\\/\\/[^/]+/i, "");
    var prefix = /\\/([^/]+)\\/assets\\/[^/]+$/.exec(path);
    if (prefix) return prefix[1];
    return path.indexOf("/assets/") === 0 ? "same-origin:" + fileOf(path) : "dev";
  }
  function pageRelease() {
    var entryTag = document.querySelector('script[type="module"][src]');
    return releaseOf(entryTag && entryTag.getAttribute("src"));
  }
  // The route pattern the address matches ("/:project/messages"), never the address itself.
  function matchScore(pattern, parts) {
    var segments = pattern.split("/").filter(Boolean), score = 0;
    for (var i = 0; i < segments.length; i++) {
      if (segments[i] === "*") return score;
      if (i >= parts.length) return -1;
      if (segments[i].charAt(0) === ":") continue;
      if (segments[i] !== parts[i]) return -1;
      score += 1;
    }
    return segments.length === parts.length ? score + 0.5 : -1;
  }
  function pathPattern() {
    var parts = location.pathname.split("/").filter(Boolean), best = "unmatched", bestScore = -1;
    for (var i = 0; i < ROUTES.length; i++) {
      var score = matchScore(ROUTES[i], parts);
      if (score > bestScore) { best = ROUTES[i]; bestScore = score; }
    }
    return best;
  }
  function queryKeys() {
    return location.search.slice(1).split("&").map(function (pair) {
      try { return decodeURIComponent(pair.split("=")[0]).slice(0, 40); } catch (e) { return ""; }
    }).filter(Boolean).slice(0, 10).join(",");
  }
  function loadingScreen() {
    if (document.querySelector('[data-testid="api-waiting"]')) return "api-waiting";
    var screen = document.querySelector('[data-testid="loading-screen"]');
    if (!screen) return "none";
    return screen.getAttribute("data-loading-reason") || "unnamed";
  }
  function slowestFile() {
    var slowest = null;
    try {
      var entries = performance.getEntriesByType("resource");
      for (var i = 0; i < entries.length; i++) {
        if (entries[i].name.indexOf("/assets/") === -1) continue;
        if (!slowest || entries[i].duration > slowest.duration) slowest = entries[i];
      }
    } catch (e) {}
    return slowest;
  }
  // The page's own code files that have not finished: a hung download never errors.
  function pendingFiles() {
    var done = {}, pending = [];
    try {
      var entries = performance.getEntriesByType("resource");
      for (var i = 0; i < entries.length; i++) done[entries[i].name.split("#")[0]] = true;
      var tags = document.querySelectorAll('script[src*="/assets/"], link[href*="/assets/"]');
      for (var j = 0; j < tags.length && pending.length < 10; j++) {
        var url = tags[j].src || tags[j].href;
        if (!done[url] && failed.indexOf(fileOf(url)) === -1) pending.push(fileOf(url));
      }
    } catch (e) {}
    return pending.join(",");
  }
  function navigationTiming() {
    try { return performance.getEntriesByType("navigation")[0] || null; } catch (e) { return null; }
  }
  function attribute(key, value) {
    if (typeof value === "boolean") return { key: key, value: { boolValue: value } };
    if (typeof value === "number") return { key: key, value: { intValue: String(Math.round(value)) } };
    return { key: key, value: { stringValue: String(value) } };
  }
  function nanos(ms) {
    var origin = performance.timeOrigin || Date.now() - performance.now();
    return String(Math.round(origin + ms)) + "000000";
  }
  function spanOf(outcome, environment, sessionId) {
    var at = now(), slowest = slowestFile(), timing = navigationTiming();
    var values = [
      ["${ATTR_BOOT_OUTCOME}", outcome],
      ["langwatch.boot.wait_ms", drawn >= 0 ? drawn : at],
      ["langwatch.boot.entry_ran", entry >= 0],
      ["langwatch.boot.mounted", mounted >= 0],
      ["langwatch.boot.health", health],
      ["langwatch.boot.loading_screen", loadingScreen()],
      ["langwatch.boot.failed_files", failed.join(",")],
      ["langwatch.boot.pending_files", drawn >= 0 ? "" : pendingFiles()],
      ["langwatch.boot.chunk_failures", chunkFailures],
      ["langwatch.boot.recovery_reloads", attemptsAtStart],
      ["langwatch.boot.release", pageRelease()],
      ["langwatch.boot.visibility", document.visibilityState],
      ["langwatch.boot.was_hidden", wasHidden],
      ["langwatch.boot.query_keys", queryKeys()],
      ["url.path", pathPattern()]
    ];
    if (drawn >= 0) values.push(["langwatch.boot.drawn_ms", drawn]);
    if (entry >= 0) values.push(["langwatch.boot.entry_ms", entry]);
    if (healthMs >= 0) values.push(["langwatch.boot.health_ms", healthMs]);
    if (mounted >= 0) values.push(["langwatch.boot.mounted_ms", mounted]);
    if (sessionId) values.push(["session.id", sessionId]);
    if (timing) {
      values.push(["langwatch.boot.html_ms", timing.responseEnd]);
      values.push(["langwatch.boot.dom_ready_ms", timing.domContentLoadedEventEnd]);
    }
    if (slowest) {
      values.push(["langwatch.boot.slowest_file", fileOf(slowest.name)]);
      values.push(["langwatch.boot.slowest_file_ms", slowest.duration]);
    }
    var resource = [attribute("service.name", "${RUM_SERVICE_NAME}")];
    if (environment) resource.push(attribute("deployment.environment.name", environment));
    var trouble = outcome === "stalled" || outcome === "reloaded";
    return { resourceSpans: [{
      resource: { attributes: resource },
      scopeSpans: [{ scope: { name: "@langwatch/boot-report" }, spans: [{
        traceId: traceId, spanId: hex(8), name: "${BOOT_SPAN_NAME}", kind: 1,
        startTimeUnixNano: nanos(0), endTimeUnixNano: nanos(drawn >= 0 ? drawn : at),
        attributes: values.map(function (pair) { return attribute(pair[0], pair[1]); }),
        status: { code: trouble ? 2 : 0 }
      }] }]
    }] };
  }
  function send(body, sessionId) {
    try {
      var beacon = new Blob([body], { type: "text/plain;charset=UTF-8" });
      if (navigator.sendBeacon && navigator.sendBeacon("${RUM_TRACES_PATH}", beacon)) return;
    } catch (e) {}
    try {
      var headers = { "content-type": "application/json" };
      if (sessionId) headers["${RUM_SESSION_HEADER}"] = sessionId;
      fetch("${RUM_TRACES_PATH}", { method: "POST", body: body, headers: headers, keepalive: true,
        credentials: "same-origin" }).catch(function () {});
    } catch (e) {}
  }
  // Built now, sent when ready: a stall's span is what the page waited on at the threshold.
  function build(outcome) {
    if (sent[outcome] || !document.getElementById("root")) return null;
    var settings = config();
    if (!settings) return null;
    var sessionId = session();
    if (outcome === "drawn" && !sampled(sessionId, settings.ratio)) return null;
    sent[outcome] = true;
    return { sessionId: sessionId, body: spanOf(outcome, settings.environment, sessionId) };
  }
  function dispatch(built) {
    if (built) send(JSON.stringify(built.body), built.sessionId);
  }
  // A held stall leaves first, so the reports arrive in the order the boot went.
  function flushStall(release) {
    if (!pendingStall) return;
    var held = pendingStall;
    pendingStall = null;
    held.body.resourceSpans[0].scopeSpans[0].spans[0].attributes.push(
      attribute("langwatch.boot.current_release", release));
    dispatch(held);
  }
  function report(outcome) {
    flushStall("unknown");
    dispatch(build(outcome));
  }
  // The release the server hands a fresh page now, to tell a stale page from a slow one.
  function currentRelease(then) {
    var answered = false;
    function answer(release) { if (!answered) { answered = true; then(release); } }
    setTimeout(function () { answer("unknown"); }, 3000);
    try {
      fetch(location.pathname, { cache: "no-store", headers: { accept: "text/html" } })
        .then(function (response) { return response.ok ? response.text() : ""; })
        .then(function (html) {
          var tag = /<script[^>]*type="module"[^>]*src="([^"]+)"/.exec(html) ||
            /<script[^>]*src="([^"]+)"[^>]*type="module"/.exec(html);
          answer(tag ? releaseOf(tag[1]) : "unknown");
        }, function () { answer("unknown"); });
    } catch (e) { answer("unknown"); }
  }
  addEventListener("error", function (event) {
    var target = event.target;
    if (!target || (target.tagName !== "SCRIPT" && target.tagName !== "LINK")) return;
    if (failed.length < 10) failed.push(fileOf(target.src || target.href));
  }, true);
  addEventListener("ui:chunk-failed", function () { chunkFailures += 1; });
  addEventListener("ui:mounted", function () { if (mounted < 0) mounted = now(); });
  document.addEventListener("${BOOT_REPORT_EVENTS.entry}", function () { if (entry < 0) entry = now(); });
  document.addEventListener("${BOOT_REPORT_EVENTS.health}", function (event) {
    var detail = event.detail || {};
    health = detail.state || health;
    if (typeof detail.ms === "number") healthMs = detail.ms;
  });
  document.addEventListener("${BOOT_REPORT_EVENTS.done}", function () {
    if (drawn >= 0) return;
    drawn = now();
    report(stalled || sent.hidden ? "recovered" : "drawn");
  });
  document.addEventListener("visibilitychange", function () {
    if (document.visibilityState !== "hidden") return;
    wasHidden = true;
    if (drawn < 0 && !left) report("hidden");
  });
  // Unloading hides the page too, after pagehide: one report says the page went.
  addEventListener("pagehide", function () {
    left = true;
    if (drawn < 0) report(attempts() > attemptsAtStart ? "reloaded" : "abandoned");
  });
  setTimeout(function () {
    if (drawn >= 0) return;
    stalled = true;
    pendingStall = build("stalled");
    if (pendingStall) currentRelease(flushStall);
  }, Math.max(${BOOT_STALL_MS} - now(), 0));
})();`;

/** The reporter as an inline script for `<head>`, ahead of the tags that load the app. */
export const BOOT_REPORT_HEAD = `<script data-boot-splash>${SCRIPT}</script>`;

/** The script's body alone, for a test to run against stand-in browser globals. */
export const BOOT_REPORT_SCRIPT = SCRIPT;
