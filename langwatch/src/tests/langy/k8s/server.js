const http = require("http");

const PORT = parseInt(process.env.PORT || "8080", 10);
const OPENCODE_BASE = process.env.OPENCODE_BASE || "http://localhost:4096";

// SSE event types we treat as terminal — once we see one for our session,
// we stop forwarding and close the response stream to the caller.
const TERMINAL_EVENT_TYPES = new Set([
  "message.completed",
  "message.done",
  "session.idle",
  "session.completed",
  "error",
]);

async function readJson(res) {
  const text = await res.text();
  if (!text) return null;
  try { return JSON.parse(text); }
  catch { throw new Error(`non-JSON response: ${text.slice(0, 200)}`); }
}

async function createSession() {
  const r = await fetch(`${OPENCODE_BASE}/session`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title: "langy" }),
  });
  if (!r.ok) throw new Error(`create session: ${r.status} ${await r.text()}`);
  const session = await readJson(r);
  return session.id ?? session.session?.id;
}

// Check if a session exists. We treat a 404 as "session is gone" — this
// happens after pod restarts. Returns true if usable, false if missing.
async function sessionAlive(sessionId) {
  try {
    const r = await fetch(`${OPENCODE_BASE}/session/${sessionId}`, {
      method: "GET",
    });
    return r.ok;
  } catch { return false; }
}

async function postMessage(sessionId, system, userText) {
  const body = {
    parts: [{ type: "text", text: userText }],
  };
  if (system) body.system = system;
  // prompt_async returns 204 immediately so we can race with the SSE stream
  // and start forwarding events before the model has finished thinking.
  const r = await fetch(`${OPENCODE_BASE}/session/${sessionId}/prompt_async`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (r.status === 404) {
    // Session vanished between our check and the post — propagate so the
    // backend can recover with a fresh session.
    const err = new Error("session-not-found");
    err.code = "session-not-found";
    throw err;
  }
  if (!r.ok && r.status !== 204) {
    throw new Error(`post message: ${r.status} ${await r.text()}`);
  }
}

function eventBelongsToSession(event, sessionId) {
  if (!sessionId) return false;
  const candidate = event.sessionID ?? event.sessionId ?? event.session_id
    ?? event.properties?.sessionID ?? event.properties?.sessionId;
  return candidate === sessionId;
}

async function streamSessionEvents(sessionId, res, signal) {
  // Open the SSE stream without the abort signal — we control termination
  // by cancelling the reader when we see a terminal event or the response
  // closes. Passing the signal to fetch caused AbortError to leak as an
  // unhandled rejection when the response closed mid-stream.
  const eventRes = await fetch(`${OPENCODE_BASE}/event`);
  if (!eventRes.ok || !eventRes.body) {
    throw new Error(`event stream failed: ${eventRes.status}`);
  }
  const reader = eventRes.body.getReader();
  // If the outer request closes, cancel the reader so we exit the loop.
  if (signal) {
    signal.addEventListener("abort", () => { reader.cancel().catch(() => {}); }, { once: true });
  }
  const decoder = new TextDecoder();
  let buf = "";
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let nl;
      while ((nl = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (!line.startsWith("data:")) continue;
        const payload = line.slice(5).trim();
        if (!payload) continue;
        let event;
        try { event = JSON.parse(payload); }
        catch { continue; }
        if (!eventBelongsToSession(event, sessionId)) continue;
        res.write(JSON.stringify(event) + "\n");
        if (TERMINAL_EVENT_TYPES.has(event.type)) {
          await reader.cancel().catch(() => {});
          return;
        }
      }
    }
  } catch (err) {
    // Reader cancellation surfaces here as a TypeError/AbortError. Treat
    // it as a normal end-of-stream — the caller has already moved on.
    if (err?.name === "AbortError" || err?.code === "ERR_INVALID_STATE") return;
    throw err;
  }
}

const server = http.createServer((req, res) => {
  if (req.method === "GET" && req.url === "/health") {
    res.writeHead(200, { "Content-Type": "text/plain" });
    res.end("ok");
    return;
  }
  if (req.method === "POST" && req.url === "/run") {
    let body = "";
    req.on("data", (c) => { body += c; });
    req.on("end", async () => {
      let parsed;
      try { parsed = JSON.parse(body); }
      catch {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "invalid JSON body" }));
        return;
      }
      const userText = parsed.prompt;
      const system = parsed.system ?? null;
      const requestedSessionId = parsed.sessionId ?? null;
      if (!userText) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "missing prompt" }));
        return;
      }
      res.writeHead(200, {
        "Content-Type": "application/x-ndjson",
        "Cache-Control": "no-cache",
      });
      const abort = new AbortController();
      req.on("close", () => abort.abort());
      try {
        // Reuse the conversation's existing session if it's still alive in
        // OpenCode, otherwise create a fresh one and tell the backend so it
        // can persist the new id.
        let sessionId = requestedSessionId;
        let createdNew = false;
        if (sessionId) {
          if (!(await sessionAlive(sessionId))) {
            console.log("requested session gone, creating new:", sessionId);
            sessionId = null;
          }
        }
        if (!sessionId) {
          sessionId = await createSession();
          createdNew = true;
          console.log("session created:", sessionId);
        } else {
          console.log("reusing session:", sessionId);
        }

        // First event the caller sees is our own session marker, so the
        // backend can persist sessionId without parsing OpenCode internals.
        res.write(JSON.stringify({
          type: "langy.session",
          sessionId,
          createdNew,
        }) + "\n");

        const streamPromise = streamSessionEvents(sessionId, res, abort.signal);
        try {
          await postMessage(sessionId, system, userText);
        } catch (err) {
          if (err.code === "session-not-found") {
            // Race: session expired after our check. Tell the backend to
            // clear the stored id and retry.
            res.write(JSON.stringify({
              type: "error",
              error: "session-not-found",
            }) + "\n");
            res.end();
            return;
          }
          throw err;
        }
        await streamPromise;
        console.log("session done:", sessionId);
        res.end();
      } catch (err) {
        console.error("ERROR:", err.message);
        try { res.write(JSON.stringify({ type: "error", error: err.message }) + "\n"); } catch {}
        res.end();
      }
    });
    return;
  }
  res.writeHead(404);
  res.end();
});

server.listen(PORT, () => { console.log("agent wrapper listening on :" + PORT); });
