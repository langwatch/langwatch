// @ts-nocheck
//
// Langy manager — process-pool model.
//
// One pod, one of THIS process. Per conversation, we spawn a dedicated
// `opencode` subprocess and route all of that conversation's turns to it.
// Credentials are NEVER held by the manager process; they arrive in each
// request body, get injected into the worker subprocess's env at spawn
// time, and die with the subprocess. This is the only thing that makes
// per-session isolation real — the OS kernel won't let worker A read
// worker B's env even though they live in the same pod.
//
// HTTP API:
//   POST /chat   (Bearer ${LANGY_INTERNAL_SECRET})
//     body: { conversationId, prompt, system?, credentials: {
//              langwatchApiKey, llmVirtualKey, gatewayBaseUrl,
//              langwatchEndpoint } }
//     resp: application/x-ndjson stream of opencode events
//   GET /health
//     resp: text/plain "ok (N/MAX workers)"
//
// Lifecycle:
//   - Workers spawn on first message of a conversation (~1-2s cold start)
//   - Reused for subsequent turns of the same conversation
//   - Killed on idle timeout (LANGY_WORKER_IDLE_MS, default 10 min)
//   - Killed on SIGTERM (pod shutdown)
//   - Killed if opencode dies on its own
//   - Cap at MAX_WORKERS concurrent; 503 when full

const http = require("http");
const net = require("net");
const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");

// ---------- Config ----------

const PORT = parseInt(process.env.PORT || "8080", 10);
const INTERNAL_SECRET = process.env.LANGY_INTERNAL_SECRET;
const MAX_WORKERS = parseInt(process.env.LANGY_MAX_WORKERS || "20", 10);
const WORKER_IDLE_MS = parseInt(
  process.env.LANGY_WORKER_IDLE_MS || String(10 * 60 * 1000),
  10,
);
const READINESS_TIMEOUT_MS = parseInt(
  process.env.LANGY_READINESS_TIMEOUT_MS || "15000",
  10,
);
const REAPER_INTERVAL_MS = 30_000;
const SESSIONS_ROOT = "/workspace/sessions";

if (!INTERNAL_SECRET) {
  console.error("fatal: LANGY_INTERNAL_SECRET is required");
  process.exit(1);
}

// ---------- Worker registry ----------
// conversationId -> WorkerEntry
//   {
//     ready: Promise<WorkerInfo>,   // resolves when the subprocess is ready;
//                                   // the entry is inserted into the map
//                                   // BEFORE this promise settles, so a
//                                   // second concurrent /chat for the same
//                                   // conversationId awaits the same spawn
//                                   // instead of racing into a duplicate one
//     info: WorkerInfo | null,      // null while ready is pending; set once
//                                   // the subprocess is up + session created
//     lastSeen: number,             // reaper input
//     inFlight: boolean,            // true while a turn is mid-stream; the
//                                   // /chat handler refuses overlapping
//                                   // turns on the same conversation so two
//                                   // streams can't share one opencode
//                                   // session
//   }
// WorkerInfo = { child, port, openCodeSessionId }
const workers = new Map();

// ---------- OpenCode SSE event types we treat as terminal ----------
const TERMINAL_EVENT_TYPES = new Set([
  "message.completed",
  "message.done",
  "session.idle",
  "session.completed",
  "error",
]);

// ---------- Helpers ----------

function getFreePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

async function readJson(res) {
  const text = await res.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`non-JSON response: ${text.slice(0, 200)}`);
  }
}

// Set up a per-worker home directory with its own opencode config,
// a substituted AGENTS.md, and a symlink to the shared skills/ dir.
// Each worker reads from this directory (cwd + HOME both point at it)
// so its config + agent guidance are isolated AND the URL placeholders
// in AGENTS.md resolve to the per-session LangWatch endpoint.
function setupWorkerHome(workerHome, credentials) {
  // 1. Per-worker opencode config.json — MCP gets the LangWatch API key.
  const configDir = path.join(workerHome, ".config", "opencode");
  fs.mkdirSync(configDir, { recursive: true });
  const config = {
    $schema: "https://opencode.ai/config.json",
    model: "openai/gpt-5-mini",
    mcp: {
      langwatch: {
        type: "local",
        command: ["langwatch-mcp-server"],
        enabled: true,
        environment: {
          LANGWATCH_API_KEY: credentials.langwatchApiKey,
          LANGWATCH_ENDPOINT: credentials.langwatchEndpoint,
        },
      },
    },
  };
  fs.writeFileSync(
    path.join(configDir, "config.json"),
    JSON.stringify(config, null, 2),
  );

  // 2. Per-worker AGENTS.md with ${LANGWATCH_ENDPOINT} substituted in.
  // The shared /workspace/AGENTS.md keeps the literal placeholder; we
  // resolve it here so each worker emits concrete URLs in its replies.
  const sharedAgents = fs.readFileSync("/workspace/AGENTS.md", "utf8");
  const perWorkerAgents = sharedAgents.replaceAll(
    "${LANGWATCH_ENDPOINT}",
    credentials.langwatchEndpoint,
  );
  fs.writeFileSync(path.join(workerHome, "AGENTS.md"), perWorkerAgents);

  // 3. Symlink skills/ to the shared template directory. Read-only
  // references; no per-worker mutation expected.
  const skillsLink = path.join(workerHome, "skills");
  try {
    fs.symlinkSync("/workspace/skills", skillsLink);
  } catch (err) {
    // EEXIST is fine — leftover from a previous worker for the same
    // conversation that didn't get fully cleaned up.
    if (err.code !== "EEXIST") throw err;
  }
}

async function waitForReadiness(port, deadlineMs) {
  const deadline = Date.now() + deadlineMs;
  while (Date.now() < deadline) {
    try {
      const r = await fetch(`http://127.0.0.1:${port}/`, {
        signal: AbortSignal.timeout(500),
      });
      // Any HTTP response (incl. 404) means the server is listening.
      if (r.status > 0) return;
    } catch {
      // Connection refused — opencode hasn't bound yet. Keep polling.
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`opencode not ready on port ${port} after ${deadlineMs}ms`);
}

async function createOpenCodeSession(port) {
  const r = await fetch(`http://127.0.0.1:${port}/session`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title: "langy" }),
  });
  if (!r.ok) {
    throw new Error(`create session: ${r.status} ${await r.text()}`);
  }
  const session = await readJson(r);
  return session.id ?? session.session?.id;
}

async function postMessage(port, sessionId, system, userText) {
  const body = { parts: [{ type: "text", text: userText }] };
  if (system) body.system = system;
  const r = await fetch(
    `http://127.0.0.1:${port}/session/${sessionId}/prompt_async`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
  );
  if (r.status === 404) {
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
  const candidate =
    event.sessionID ??
    event.sessionId ??
    event.session_id ??
    event.properties?.sessionID ??
    event.properties?.sessionId;
  return candidate === sessionId;
}

async function streamSessionEvents(port, sessionId, res, signal) {
  const eventRes = await fetch(`http://127.0.0.1:${port}/event`);
  if (!eventRes.ok || !eventRes.body) {
    throw new Error(`event stream failed: ${eventRes.status}`);
  }
  const reader = eventRes.body.getReader();
  if (signal) {
    signal.addEventListener(
      "abort",
      () => {
        reader.cancel().catch(() => {});
      },
      { once: true },
    );
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
        try {
          event = JSON.parse(payload);
        } catch {
          continue;
        }
        if (!eventBelongsToSession(event, sessionId)) continue;
        res.write(JSON.stringify(event) + "\n");
        if (TERMINAL_EVENT_TYPES.has(event.type)) {
          await reader.cancel().catch(() => {});
          return;
        }
      }
    }
  } catch (err) {
    if (err?.name === "AbortError" || err?.code === "ERR_INVALID_STATE") return;
    throw err;
  }
}

// ---------- Worker lifecycle ----------

// Spawn + wait-for-ready + create opencode session. Called from
// getOrSpawnWorker, which is the only caller — never invoke directly:
// the map entry must exist before the first await so concurrent
// requests don't double-spawn.
async function startWorkerSubprocess(conversationId, credentials) {
  const workerHome = path.join(SESSIONS_ROOT, conversationId);
  fs.mkdirSync(workerHome, { recursive: true });
  setupWorkerHome(workerHome, credentials);

  const port = await getFreePort();

  // cwd + HOME both point at workerHome so opencode reads the per-worker
  // AGENTS.md (with concrete URLs) and per-worker config (with the right
  // MCP env). Env vars carry the per-session credentials redundantly so
  // the MCP server gets them via env OR via config.json — defense in depth.
  const child = spawn(
    "opencode",
    ["serve", "--port", String(port), "--hostname", "127.0.0.1"],
    {
      env: {
        ...process.env,
        HOME: workerHome,
        OPENAI_BASE_URL: credentials.gatewayBaseUrl,
        OPENAI_API_KEY: credentials.llmVirtualKey,
        LANGWATCH_API_KEY: credentials.langwatchApiKey,
        LANGWATCH_ENDPOINT: credentials.langwatchEndpoint,
      },
      cwd: workerHome,
      stdio: ["ignore", "inherit", "inherit"],
    },
  );

  // Identity check: only delete the entry if it still points at THIS
  // child. A late-firing exit from a previously-killed worker must not
  // remove a fresh entry that has since replaced it.
  child.on("exit", (code, signal) => {
    console.log(
      `worker ${conversationId} exited (code=${code}, signal=${signal})`,
    );
    const current = workers.get(conversationId);
    if (current?.info?.child === child) {
      workers.delete(conversationId);
    }
  });

  // Single try wraps everything between spawn and "session created".
  // Any failure here — readiness timeout, opencode crash during boot,
  // /session POST failing — must kill the child so we don't leak a
  // subprocess that's not in the workers map and not visible to the
  // reaper.
  let openCodeSessionId;
  try {
    await waitForReadiness(port, READINESS_TIMEOUT_MS);
    openCodeSessionId = await createOpenCodeSession(port);
  } catch (err) {
    try {
      child.kill("SIGTERM");
    } catch {}
    throw err;
  }

  console.log(
    `worker ${conversationId} ready on :${port} (session ${openCodeSessionId})`,
  );
  return { child, port, openCodeSessionId };
}

// Returns the WorkerEntry once the worker is ready. The map entry is
// inserted BEFORE the first await, so a second concurrent first-turn
// for the same conversationId awaits the same spawn instead of starting
// a parallel one (which would leak an orphan subprocess invisible to
// the reaper). Looped so that if N waiters were all blocked on a failed
// spawn, only the first to resume actually spawns a replacement; the
// rest see the new entry on the next iteration.
async function getOrSpawnWorker(conversationId, credentials) {
  while (true) {
    const existing = workers.get(conversationId);
    if (existing) {
      try {
        await existing.ready;
        return existing;
      } catch {
        // ready rejected — the failing spawn's IIFE deleted the entry
        // (see catch below). Loop to re-check whether another waiter
        // has already started a fresh spawn before we try ourselves.
        continue;
      }
    }

    if (workers.size >= MAX_WORKERS) {
      const err = new Error("max-workers-reached");
      err.code = "max-workers-reached";
      throw err;
    }

    const entry = {
      ready: null,
      info: null,
      lastSeen: Date.now(),
      inFlight: false,
    };
    entry.ready = (async () => {
      try {
        const info = await startWorkerSubprocess(conversationId, credentials);
        entry.info = info;
        return info;
      } catch (err) {
        // Remove only if we're still the registered entry — a fresh
        // spawn started after us must not be evicted by our failure.
        if (workers.get(conversationId) === entry) {
          workers.delete(conversationId);
        }
        throw err;
      }
    })();
    workers.set(conversationId, entry);
    await entry.ready;
    return entry;
  }
}

function killWorker(conversationId, reason) {
  const w = workers.get(conversationId);
  if (!w) return;
  console.log(`killing worker ${conversationId}: ${reason}`);
  try {
    w.info?.child.kill("SIGTERM");
  } catch {}
  // The exit handler removes from map; force-clean here in case it races
  // (or in case info is null because spawn is still in flight).
  workers.delete(conversationId);
}

setInterval(() => {
  const cutoff = Date.now() - WORKER_IDLE_MS;
  for (const [convId, w] of workers) {
    // Don't reap workers that are mid-turn or still spawning. Skipping
    // pending entries (info === null) avoids killing a subprocess
    // before its map entry has a child handle to SIGTERM.
    if (!w.info || w.inFlight) continue;
    if (w.lastSeen < cutoff) {
      killWorker(convId, "idle timeout");
    }
  }
}, REAPER_INTERVAL_MS).unref();

function shutdownAll(signal) {
  console.log(`got ${signal}, killing ${workers.size} workers`);
  for (const convId of [...workers.keys()]) {
    killWorker(convId, "shutdown");
  }
  process.exit(0);
}
process.on("SIGTERM", () => shutdownAll("SIGTERM"));
process.on("SIGINT", () => shutdownAll("SIGINT"));

// ---------- HTTP handler ----------

function unauthorized(res) {
  res.writeHead(401, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ error: "unauthorized" }));
}

function badRequest(res, message) {
  res.writeHead(400, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ error: message }));
}

const server = http.createServer((req, res) => {
  if (req.method === "GET" && req.url === "/health") {
    res.writeHead(200, { "Content-Type": "text/plain" });
    res.end(`ok (${workers.size}/${MAX_WORKERS} workers)`);
    return;
  }

  if (req.method === "POST" && req.url === "/chat") {
    const auth = req.headers["authorization"];
    if (auth !== `Bearer ${INTERNAL_SECRET}`) {
      unauthorized(res);
      return;
    }

    let body = "";
    req.on("data", (c) => {
      body += c;
    });
    req.on("end", async () => {
      let parsed;
      try {
        parsed = JSON.parse(body);
      } catch {
        badRequest(res, "invalid JSON body");
        return;
      }

      const { conversationId, prompt, system, credentials } = parsed;
      if (!conversationId || !prompt || !credentials) {
        badRequest(res, "missing required: conversationId, prompt, credentials");
        return;
      }
      if (
        !credentials.langwatchApiKey ||
        !credentials.llmVirtualKey ||
        !credentials.gatewayBaseUrl ||
        !credentials.langwatchEndpoint
      ) {
        badRequest(res, "credentials must include langwatchApiKey, llmVirtualKey, gatewayBaseUrl, langwatchEndpoint");
        return;
      }

      res.writeHead(200, {
        "Content-Type": "application/x-ndjson",
        "Cache-Control": "no-cache",
      });

      const abort = new AbortController();
      req.on("close", () => abort.abort());

      let acquiredWorker = null;
      try {
        let worker;
        try {
          worker = await getOrSpawnWorker(conversationId, credentials);
        } catch (err) {
          if (err.code === "max-workers-reached") {
            res.write(
              JSON.stringify({ type: "error", error: "at-capacity" }) + "\n",
            );
            res.end();
            return;
          }
          throw err;
        }

        // Per-conversation turn mutex. Two overlapping turns on the
        // same conversationId would share one opencode session and one
        // /event stream, interleaving each other's deltas + terminal
        // events. Refuse the second turn instead — the control plane
        // surfaces this so the user sees a clear error rather than a
        // corrupted reply.
        if (worker.inFlight) {
          res.write(
            JSON.stringify({ type: "error", error: "turn-in-flight" }) + "\n",
          );
          res.end();
          return;
        }
        worker.inFlight = true;
        acquiredWorker = worker;
        worker.lastSeen = Date.now();

        const info = worker.info;

        // Defensive .catch so a rejection on the SSE side (e.g. opencode
        // dies mid-stream) doesn't escape as an unhandled rejection when
        // we early-return below without awaiting it.
        let streamError = null;
        const streamPromise = streamSessionEvents(
          info.port,
          info.openCodeSessionId,
          res,
          abort.signal,
        ).catch((err) => {
          streamError = err;
        });

        try {
          await postMessage(
            info.port,
            info.openCodeSessionId,
            system,
            prompt,
          );
        } catch (err) {
          if (err.code === "session-not-found") {
            // Worker's internal opencode session vanished mid-turn (rare —
            // happens if opencode garbage-collects sessions on its own).
            // Kill the worker so the next request gets a fresh one.
            // Killing the worker terminates the SSE source, which lets
            // streamPromise settle via its .catch.
            killWorker(conversationId, "opencode session vanished");
            abort.abort();
            res.write(
              JSON.stringify({ type: "error", error: "session-not-found" }) +
                "\n",
            );
            res.end();
            return;
          }
          // Stream is still subscribed to /event waiting for a terminal
          // event that will never come (we never successfully posted).
          // Abort so reader.cancel() fires and streamPromise resolves
          // via its .catch — otherwise it leaks an open HTTP connection
          // to opencode for this worker's session.
          abort.abort();
          throw err;
        }

        await streamPromise;
        if (streamError) throw streamError;
        res.end();
      } catch (err) {
        console.error(`ERROR (${conversationId}):`, err.message);
        try {
          res.write(
            JSON.stringify({ type: "error", error: err.message }) + "\n",
          );
        } catch {}
        res.end();
      } finally {
        if (acquiredWorker) acquiredWorker.inFlight = false;
      }
    });
    return;
  }

  res.writeHead(404);
  res.end();
});

server.listen(PORT, () => {
  console.log(
    `langy manager listening on :${PORT}, MAX_WORKERS=${MAX_WORKERS}`,
  );
});
