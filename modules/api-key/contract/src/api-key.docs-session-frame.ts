/**
 * The docs session frame (ADR-185, amendment of 2026-10-28): the app-origin document a docs
 * site embeds, which holds the key so it never enters the docs page and its analytics. Only
 * strings, so the API host that serves it builds it too.
 * @see modules/api-key/specs/docs-session-frame.feature
 */
import { DOCS_SESSION_MESSAGE_TYPE, DOCS_SESSION_MESSAGE_VERSION } from "./api-key.docs-session.ts";

/** Where the API host serves the frame; `?origin=` names the docs site embedding it. */
export const DOCS_SESSION_FRAME_PATH = "/connect/docs/frame";

/** The `type` of every message between the frame and the docs page that embeds it. */
export const DOCS_FRAME_MESSAGE_TYPE = "langwatch:docs-frame" as const;
export const DOCS_FRAME_MESSAGE_VERSION = 1 as const;

/** How long a confirmation must show before Send counts, so a press is not tricked into it. */
export const DOCS_FRAME_CONFIRM_DELAY_MS = 600;

const NONCE_PATTERN = /^[A-Za-z0-9+/=_-]+$/;

/** Embeds a value in the inline script; `<` is escaped so no string can close the tag. */
function scriptValue(value: unknown): string {
  return JSON.stringify(value).replaceAll("<", "\\u003c");
}

/**
 * The frame for one registered docs origin, every inline tag under the answer's nonce. The
 * caller has already checked that `embedder` is registered; it names the only parent the
 * frame talks to.
 */
export function buildDocsSessionFrameDocument({
  nonce,
  embedder,
  timings = {},
}: {
  nonce: string;
  embedder: string;
  /** Shorter waits for a test; a served frame always uses the defaults. */
  timings?: Partial<Record<"confirmDelayMs" | "connectTimeoutMs" | "requestTimeoutMs", number>>;
}): string {
  if (!NONCE_PATTERN.test(nonce)) throw new Error("invalid docs frame nonce");

  return [
    "<!doctype html>",
    '<html lang="en"><head><meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    "<title>LangWatch account connection</title>",
    `<style nonce="${nonce}">${FRAME_STYLE}</style>`,
    "</head><body>",
    FRAME_MARKUP,
    `<script nonce="${nonce}">`,
    `(${FRAME_RUNTIME})(${scriptValue({
      docsOrigin: embedder,
      connectPath: "/connect/docs",
      revokePath: "/api/docs-session",
      consentType: DOCS_SESSION_MESSAGE_TYPE,
      consentVersion: DOCS_SESSION_MESSAGE_VERSION,
      frameType: DOCS_FRAME_MESSAGE_TYPE,
      frameVersion: DOCS_FRAME_MESSAGE_VERSION,
      confirmDelayMs: DOCS_FRAME_CONFIRM_DELAY_MS,
      connectTimeoutMs: 120_000,
      requestTimeoutMs: 30_000,
      ...timings,
    })});`,
    "</script>",
    "</body></html>",
  ].join("\n");
}

/** What an origin that is not registered for docs is shown; nothing may frame it. */
export function buildDocsSessionFrameRefusal(): string {
  return [
    "<!doctype html>",
    '<html lang="en"><head><meta charset="utf-8"><title>LangWatch</title></head><body>',
    "<p>This site is not registered to connect to LangWatch.</p>",
    "</body></html>",
  ].join("\n");
}

const FRAME_STYLE = `
:root { color-scheme: light dark; --ink: #141417; --muted: #5f5f68; --line: #d4d4d8; --paper: #fff; }
@media (prefers-color-scheme: dark) {
  :root { --ink: #f4f4f5; --muted: #a1a1aa; --line: #3f3f46; --paper: #141417; }
}
html, body { margin: 0; background: transparent; }
body { font: 13px/1.45 system-ui, -apple-system, "Segoe UI", sans-serif; color: var(--ink); }
main { display: flex; flex-direction: column; gap: 6px; padding: 2px; }
.row { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
button {
  font: inherit; font-weight: 500; min-height: 32px; padding: 0 12px; border-radius: 6px;
  border: 1px solid var(--line); background: var(--paper); color: var(--ink); cursor: pointer;
}
button:focus-visible { outline: 2px solid #f56b1a; outline-offset: 2px; }
button:disabled { opacity: 0.6; cursor: default; }
button.primary { background: var(--ink); color: var(--paper); border-color: var(--ink); }
button.quiet { border-color: transparent; background: transparent; }
p { margin: 0; }
#status { font-size: 12px; color: var(--muted); }
#confirm { display: flex; flex-direction: column; gap: 6px; padding: 8px; border: 1px solid var(--line); border-radius: 6px; }
#confirm code { font: 12px ui-monospace, monospace; }
[hidden] { display: none !important; }
`;

const FRAME_MARKUP = `
<main>
  <div class="row">
    <button id="connect" type="button">Use my LangWatch account</button>
    <button id="disconnect" class="quiet" type="button" hidden>Disconnect</button>
  </div>
  <div id="confirm" role="group" aria-labelledby="confirm-text" hidden>
    <p id="confirm-text"></p>
    <div class="row">
      <button id="confirm-send" class="primary" type="button">Send</button>
      <button id="confirm-cancel" class="quiet" type="button">Cancel</button>
    </div>
  </div>
  <p id="status" role="status" aria-live="polite">Or paste an API key below.</p>
</main>
`;

/*
 * The frame's whole behaviour, one function the document calls with its settings. It
 * references nothing outside itself. Messages from the docs page count only from the parent
 * at the docs origin; answers from the consent popup only from that popup at this origin.
 */
const FRAME_RUNTIME = String.raw`function (config) {
  "use strict";
  var NOTES = {
    idle: "Or paste an API key below.",
    waiting: "Waiting for LangWatch…",
    denied: "You did not allow access. Paste an API key below instead.",
    blocked: "Your browser blocked the LangWatch window. Allow pop-ups for this site, or paste an API key below.",
    closed: "The LangWatch window closed before access was granted. Try again, or paste an API key.",
    timeout: "LangWatch did not answer within two minutes. Try again, or paste an API key.",
    ended: "Your access ended. Connect again to keep sending.",
    disconnected: "Disconnected.",
    local: "Disconnected here. LangWatch could not be reached, so the access ends on its own within five minutes.",
    notEmbedded: "Open this from the API playground in the docs."
  };
  var METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"];
  var DROPPED_HEADERS = ["x-auth-token", "authorization", "cookie", "proxy-authorization"];
  var HEADER_NAME = /^[!#$%&'*+.^_\x60|~0-9A-Za-z-]+$/;
  var STATE_PATTERN = /^[A-Za-z0-9_-]{43}$/;

  var byId = function (id) { return document.getElementById(id); };
  var connectButton = byId("connect");
  var disconnectButton = byId("disconnect");
  var statusLine = byId("status");
  var confirmPanel = byId("confirm");
  var confirmText = byId("confirm-text");
  var confirmSend = byId("confirm-send");
  var confirmCancel = byId("confirm-cancel");

  var embedded = window.parent !== window;
  var session = null;
  var expiryTimer = 0;
  var waiting = null;
  var pending = null;
  var inFlight = {};

  function toParent(message) {
    if (!embedded) return;
    message.type = config.frameType;
    message.version = config.frameVersion;
    window.parent.postMessage(message, config.docsOrigin);
  }

  function minutesLeft() {
    var minutes = Math.max(1, Math.ceil((session.endsAt - performance.now()) / 60000));
    return minutes === 1 ? "a minute" : minutes + " minutes";
  }

  function show(note) {
    connectButton.hidden = Boolean(session);
    disconnectButton.hidden = !session;
    connectButton.disabled = !embedded || Boolean(waiting);
    statusLine.textContent = session
      ? "Sending as you in " + session.project.name + ". Access ends within " + minutesLeft() + "." + (note ? " " + note : "")
      : note || (embedded ? NOTES.idle : NOTES.notEmbedded);
    toParent({ kind: "state", connected: Boolean(session), project: session ? session.project.name : null });
  }

  function clear(note) {
    window.clearTimeout(expiryTimer);
    var had = Boolean(session);
    session = null;
    Object.keys(inFlight).forEach(function (id) { inFlight[id].abort("cancelled"); });
    dismissConfirm("cancelled");
    if (had || note) show(note);
  }

  function setSession(next) {
    session = next;
    window.clearTimeout(expiryTimer);
    expiryTimer = window.setTimeout(function () { clear(NOTES.ended); }, Math.max(0, next.endsAt - performance.now()));
    show();
  }

  function newState() {
    var bytes = crypto.getRandomValues(new Uint8Array(32));
    return btoa(String.fromCharCode.apply(null, bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }

  function readAnswer(data, state) {
    if (!data || typeof data !== "object") return null;
    if (data.type !== config.consentType || data.version !== config.consentVersion) return null;
    if (typeof data.state !== "string" || !STATE_PATTERN.test(data.state) || data.state !== state) return null;
    if (data.outcome === "denied") return { outcome: "denied" };
    if (data.outcome !== "granted") return null;
    var project = data.project;
    if (typeof data.token !== "string" || data.token.length < 16) return null;
    if (typeof data.expiresIn !== "number" || !isFinite(data.expiresIn) || data.expiresIn <= 0) return null;
    if (!project || typeof project.id !== "string" || !project.id || typeof project.name !== "string") return null;
    return { outcome: "granted", token: data.token, expiresIn: data.expiresIn, project: { id: project.id, name: project.name } };
  }

  function connect() {
    if (!embedded || waiting) return;
    var state = newState();
    var url = new URL(config.connectPath, location.origin);
    url.searchParams.set("origin", config.docsOrigin);
    url.searchParams.set("state", state);
    var popup = window.open(url.href, "langwatch-docs-connect", "popup,width=520,height=720");
    if (!popup) return show(NOTES.blocked);
    var finish = function (note) {
      window.removeEventListener("message", onAnswer);
      window.clearInterval(watch);
      window.clearTimeout(timeout);
      waiting = null;
      show(note);
    };
    var onAnswer = function (event) {
      if (event.origin !== location.origin || event.source !== popup) return;
      var answer = readAnswer(event.data, state);
      if (!answer) return;
      if (answer.outcome === "denied") return finish(NOTES.denied);
      waiting = null;
      window.removeEventListener("message", onAnswer);
      window.clearInterval(watch);
      window.clearTimeout(timeout);
      setSession({ token: answer.token, project: answer.project, endsAt: performance.now() + answer.expiresIn * 1000 });
    };
    var watch = window.setInterval(function () { if (popup.closed) finish(NOTES.closed); }, 500);
    var timeout = window.setTimeout(function () { popup.close(); finish(NOTES.timeout); }, config.connectTimeoutMs);
    waiting = finish;
    window.addEventListener("message", onAnswer);
    show(NOTES.waiting);
  }

  function revoke(key, keepalive) {
    return fetch(config.revokePath, {
      method: "DELETE",
      headers: { "X-Auth-Token": key.token },
      credentials: "omit",
      redirect: "error",
      cache: "no-store",
      keepalive: keepalive
    });
  }

  function disconnect() {
    var key = session;
    clear();
    if (!key) return;
    revoke(key, false).then(
      function (response) { show(response.ok ? NOTES.disconnected : NOTES.local); },
      function () { show(NOTES.local); }
    );
  }

  /* The request the docs page asked for, or null for anything the frame was not built to send. */
  function readRequest(data) {
    if (typeof data.id !== "string" || !data.id || data.id.length > 64) return null;
    if (METHODS.indexOf(data.method) < 0) return null;
    if (typeof data.path !== "string" || data.path.indexOf("/api/") !== 0) return null;
    var url;
    try { url = new URL(data.path, location.origin); } catch (error) { return null; }
    if (url.origin !== location.origin || url.pathname.indexOf("/api/") !== 0) return null;
    var headers = {};
    var named = data.headers && typeof data.headers === "object" ? data.headers : {};
    Object.keys(named).slice(0, 50).forEach(function (name) {
      var value = named[name];
      if (typeof value !== "string" || !HEADER_NAME.test(name)) return;
      if (DROPPED_HEADERS.indexOf(name.toLowerCase()) >= 0) return;
      headers[name] = value;
    });
    var body = typeof data.body === "string" && data.method !== "GET" ? data.body : null;
    return { id: data.id, method: data.method, url: url, headers: headers, body: body };
  }

  function answer(id, message) {
    message.id = id;
    toParent(message);
  }

  function send(request) {
    if (!session) return answer(request.id, { kind: "failed", reason: "not-connected" });
    var key = session;
    var abort = new AbortController();
    inFlight[request.id] = abort;
    var timer = window.setTimeout(function () { abort.abort("timeout"); }, config.requestTimeoutMs);
    var started = performance.now();
    var headers = Object.assign({}, request.headers, { "X-Auth-Token": key.token });
    fetch(request.url.pathname + request.url.search, {
      method: request.method,
      headers: headers,
      body: request.body,
      signal: abort.signal,
      credentials: "omit",
      redirect: "error",
      cache: "no-store"
    })
      .then(function (response) {
        return response.text().then(function (body) {
          var list = [];
          response.headers.forEach(function (value, name) { list.push([name, value]); });
          answer(request.id, {
            kind: "response",
            status: response.status,
            statusText: response.statusText,
            contentType: response.headers.get("content-type") || "unknown",
            headers: list,
            body: body,
            ms: Math.round(performance.now() - started)
          });
          if (response.status === 401 && session === key) clear(NOTES.ended);
          else if (response.status === 403 && session === key)
            show("Your access in " + key.project.name + " does not allow this request.");
        });
      })
      .catch(function () {
        var reason = abort.signal.aborted ? (abort.signal.reason === "timeout" ? "timeout" : "cancelled") : "network";
        answer(request.id, { kind: "failed", reason: reason });
      })
      .finally(function () {
        window.clearTimeout(timer);
        delete inFlight[request.id];
      });
  }

  function dismissConfirm(reason) {
    if (!pending) return;
    var request = pending.request;
    pending = null;
    confirmPanel.hidden = true;
    if (reason) answer(request.id, { kind: "failed", reason: reason });
  }

  function confirmWrite(request) {
    dismissConfirm("cancelled");
    pending = { request: request, shownAt: performance.now() };
    confirmText.textContent = "";
    confirmText.append("Send ");
    var code = document.createElement("code");
    code.textContent = request.method + " " + request.url.pathname;
    confirmText.append(code, " as you in " + session.project.name + "?");
    confirmPanel.hidden = false;
    confirmSend.focus();
  }

  window.addEventListener("message", function (event) {
    if (event.source !== window.parent || event.origin !== config.docsOrigin || !embedded) return;
    var data = event.data;
    if (!data || typeof data !== "object" || data.type !== config.frameType || data.version !== config.frameVersion) return;
    if (data.kind === "cancel" && typeof data.id === "string") {
      if (pending && pending.request.id === data.id) dismissConfirm("cancelled");
      if (inFlight[data.id]) inFlight[data.id].abort("cancelled");
      return;
    }
    if (data.kind !== "send") return;
    var request = readRequest(data);
    if (!request) {
      if (typeof data.id === "string") answer(data.id, { kind: "failed", reason: "refused" });
      return;
    }
    if (!session) return answer(request.id, { kind: "failed", reason: "not-connected" });
    if (request.method === "GET") send(request);
    else confirmWrite(request);
  });

  /* Only this origin can reach these buttons: a parent on another origin cannot press them. */
  connectButton.addEventListener("click", connect);
  disconnectButton.addEventListener("click", disconnect);
  confirmSend.addEventListener("click", function () {
    if (!pending || !session) return;
    if (performance.now() - pending.shownAt < config.confirmDelayMs) return;
    var request = pending.request;
    dismissConfirm(null);
    send(request);
  });
  confirmCancel.addEventListener("click", function () { dismissConfirm("declined"); });

  /* Leaving the page, or the docs removing the frame, ends the key on the way out. */
  window.addEventListener("pagehide", function () {
    var key = session;
    clear();
    if (key) revoke(key, true).catch(function () {});
  });

  if (typeof ResizeObserver === "function") {
    new ResizeObserver(function () {
      toParent({ kind: "height", height: Math.ceil(document.documentElement.scrollHeight) });
    }).observe(document.body);
  }
  show();
}`;
