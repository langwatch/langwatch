// @ts-nocheck
//
// Langy manager core — process-pool model factored out of server.js.
//
// One pod, one OS process running server.js. Per conversation we spawn a
// dedicated `opencode` subprocess and route all of that conversation's
// turns to it. Credentials are NEVER held by the manager process; they
// arrive in each request body, get injected into the worker subprocess's
// env at spawn time, and die with the subprocess. OS process boundaries
// are what make per-session isolation real — worker A cannot read worker
// B's env, file descriptors, or memory even though both live in the same
// pod.
//
// This file is dependency-free (just node stdlib) so it can be exercised
// from a smoke harness with an injected startWorker stub. server.js wires
// it up with real env + spawn + HTTP listener.

const net = require("net");
const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");

// OpenCode SSE event types we treat as terminal (response complete).
const TERMINAL_EVENT_TYPES = new Set([
  "message.completed",
  "message.done",
  "session.idle",
  "session.completed",
  "error",
]);

// ============================================================================
// Low-level helpers
// ============================================================================

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
function setupWorkerHome(
  workerHome,
  credentials,
  { agentsTemplatePath, skillsDir },
) {
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
  const sharedAgents = fs.readFileSync(agentsTemplatePath, "utf8");
  const perWorkerAgents = sharedAgents.replaceAll(
    "${LANGWATCH_ENDPOINT}",
    credentials.langwatchEndpoint,
  );
  fs.writeFileSync(path.join(workerHome, "AGENTS.md"), perWorkerAgents);

  // 3. Symlink skills/ to the shared template directory.
  const skillsLink = path.join(workerHome, "skills");
  try {
    fs.symlinkSync(skillsDir, skillsLink);
  } catch (err) {
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

// ============================================================================
// Default `startWorker` — the production spawn path. Smoke tests inject
// a stub instead so they exercise the registry without a real opencode.
// ============================================================================

function makeDefaultStartWorker({
  sessionsRoot,
  agentsTemplatePath,
  skillsDir,
  readinessTimeoutMs,
  logger = console,
}) {
  return async function startWorker(conversationId, credentials) {
    const workerHome = path.join(sessionsRoot, conversationId);
    fs.mkdirSync(workerHome, { recursive: true });
    setupWorkerHome(workerHome, credentials, {
      agentsTemplatePath,
      skillsDir,
    });

    const port = await getFreePort();

    // cwd + HOME both point at workerHome so opencode reads the per-worker
    // AGENTS.md and per-worker config. Env vars carry the per-session
    // credentials redundantly so the MCP server gets them via env OR via
    // config.json — defense in depth.
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

    // Single try wraps everything between spawn and "session created".
    // Any failure here — readiness timeout, opencode crash during boot,
    // /session POST failing — must kill the child so we don't leak a
    // subprocess that's not in the workers map and not visible to the
    // reaper.
    let openCodeSessionId;
    try {
      await waitForReadiness(port, readinessTimeoutMs);
      openCodeSessionId = await createOpenCodeSession(port);
    } catch (err) {
      try {
        child.kill("SIGTERM");
      } catch {}
      throw err;
    }

    logger.log(
      `worker ${conversationId} ready on :${port} (session ${openCodeSessionId})`,
    );
    return { child, port, openCodeSessionId };
  };
}

// ============================================================================
// Worker registry — owns the conversationId → WorkerEntry map and its
// lifecycle. WorkerEntry = { ready, info, lastSeen, inFlight }.
// ============================================================================

function createWorkerRegistry({
  startWorker,
  maxWorkers,
  idleMs,
  logger = console,
}) {
  const workers = new Map();

  // Returns the WorkerEntry once the worker is ready. The map entry is
  // inserted BEFORE the first await, so a second concurrent first-turn
  // for the same conversationId awaits the same spawn instead of starting
  // a parallel one (which would leak an orphan subprocess invisible to
  // the reaper). Looped so if N waiters were all blocked on a failed
  // spawn, only the first to resume creates a replacement; the rest see
  // the new entry on the next iteration.
  async function getOrSpawnWorker(conversationId, credentials) {
    while (true) {
      const existing = workers.get(conversationId);
      if (existing) {
        try {
          await existing.ready;
          return existing;
        } catch {
          // ready rejected — the failing spawn's IIFE deleted the entry.
          // Loop to re-check whether another waiter has already started a
          // fresh spawn before we try ourselves.
          continue;
        }
      }

      if (workers.size >= maxWorkers) {
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
          const info = await startWorker(conversationId, credentials);
          entry.info = info;
          // Identity check inside the exit handler: only delete the map
          // entry if it still points at THIS child. A late-firing exit
          // from a previously-killed worker must not evict a fresh entry
          // that has since replaced it.
          info.child.on("exit", (code, signal) => {
            logger.log(
              `worker ${conversationId} exited (code=${code}, signal=${signal})`,
            );
            const current = workers.get(conversationId);
            if (current?.info?.child === info.child) {
              workers.delete(conversationId);
            }
          });
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
    logger.log(`killing worker ${conversationId}: ${reason}`);
    try {
      w.info?.child.kill("SIGTERM");
    } catch {}
    // The exit handler removes from map; force-clean here in case it
    // races (or in case info is null because spawn is still in flight).
    workers.delete(conversationId);
  }

  function reapIdle(now = Date.now()) {
    const cutoff = now - idleMs;
    for (const [convId, w] of workers) {
      // Don't reap workers that are mid-turn or still spawning. Skipping
      // pending entries (info === null) avoids killing a subprocess
      // before its map entry has a child handle to SIGTERM.
      if (!w.info || w.inFlight) continue;
      if (w.lastSeen < cutoff) {
        killWorker(convId, "idle timeout");
      }
    }
  }

  function shutdownAll(signal) {
    logger.log(`got ${signal}, killing ${workers.size} workers`);
    for (const convId of [...workers.keys()]) {
      killWorker(convId, "shutdown");
    }
  }

  return {
    workers,
    getOrSpawnWorker,
    killWorker,
    reapIdle,
    shutdownAll,
  };
}

// ============================================================================
// HTTP `/chat` handler — orchestrates one turn against a registry worker.
// Pure orchestration: registry does spawn, this does
// auth → parse → validate → mutex → post → stream → cleanup.
// ============================================================================

function unauthorized(res) {
  res.writeHead(401, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ error: "unauthorized" }));
}

function badRequest(res, message) {
  res.writeHead(400, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ error: message }));
}

function writeErrorEvent(res, error) {
  res.write(JSON.stringify({ type: "error", error }) + "\n");
}

// Read + parse the JSON body for one /chat request. Returns
// { error, parsed }. If error is non-null, the caller should write
// the response and return — body was unparseable or missing fields.
function readChatBody(body) {
  let parsed;
  try {
    parsed = JSON.parse(body);
  } catch {
    return { error: "invalid JSON body" };
  }
  const { conversationId, prompt, credentials } = parsed;
  if (!conversationId || !prompt || !credentials) {
    return { error: "missing required: conversationId, prompt, credentials" };
  }
  if (
    !credentials.langwatchApiKey ||
    !credentials.llmVirtualKey ||
    !credentials.gatewayBaseUrl ||
    !credentials.langwatchEndpoint
  ) {
    return {
      error:
        "credentials must include langwatchApiKey, llmVirtualKey, gatewayBaseUrl, langwatchEndpoint",
    };
  }
  return { parsed };
}

// Acquire a worker entry for this turn + mark it inFlight. Returns either
// { worker } on success or { errorEvent } if we should write an error event
// (at-capacity, turn-in-flight) and stop.
async function acquireTurn(registry, conversationId, credentials) {
  let worker;
  try {
    worker = await registry.getOrSpawnWorker(conversationId, credentials);
  } catch (err) {
    if (err.code === "max-workers-reached") {
      return { errorEvent: "at-capacity" };
    }
    throw err;
  }
  if (worker.inFlight) {
    // Two overlapping turns on the same conversationId would share one
    // opencode session and one /event stream, interleaving deltas and
    // terminal events. Refuse the second turn instead — the control plane
    // surfaces this so the user sees a clear error.
    return { errorEvent: "turn-in-flight" };
  }
  worker.inFlight = true;
  worker.lastSeen = Date.now();
  return { worker };
}

// Run a turn on an already-acquired worker. Owns post + stream + abort
// orchestration. Caller is responsible for releasing the inFlight flag.
async function runTurn({ registry, worker, conversationId, prompt, system, res, abortSignal }) {
  const info = worker.info;
  // Defensive .catch so a rejection on the SSE side (e.g. opencode dies
  // mid-stream) doesn't escape as an unhandled rejection if we early-
  // return below without awaiting it.
  let streamError = null;
  const streamPromise = streamSessionEvents(
    info.port,
    info.openCodeSessionId,
    res,
    abortSignal,
  ).catch((err) => {
    streamError = err;
  });

  try {
    await postMessage(info.port, info.openCodeSessionId, system, prompt);
  } catch (err) {
    if (err.code === "session-not-found") {
      // Worker's internal opencode session vanished mid-turn. Kill the
      // worker so the next request gets a fresh one. Killing terminates
      // the SSE source, which lets streamPromise settle via its .catch.
      registry.killWorker(conversationId, "opencode session vanished");
      // abort.abort signaled separately by the caller's controller.
      writeErrorEvent(res, "session-not-found");
      return;
    }
    // Stream is subscribed to /event waiting for a terminal event that
    // will never come (we never successfully posted). Caller will abort
    // so reader.cancel() fires and streamPromise resolves via .catch.
    throw err;
  }

  await streamPromise;
  if (streamError) throw streamError;
}

function createChatHandler({ registry, internalSecret, logger = console }) {
  return function handle(req, res) {
    const auth = req.headers["authorization"];
    if (auth !== `Bearer ${internalSecret}`) {
      unauthorized(res);
      return;
    }

    let body = "";
    req.on("data", (c) => {
      body += c;
    });
    req.on("end", async () => {
      const { error, parsed } = readChatBody(body);
      if (error) {
        badRequest(res, error);
        return;
      }
      const { conversationId, prompt, system, credentials } = parsed;

      res.writeHead(200, {
        "Content-Type": "application/x-ndjson",
        "Cache-Control": "no-cache",
      });

      const abort = new AbortController();
      req.on("close", () => abort.abort());

      let acquiredWorker = null;
      try {
        const acq = await acquireTurn(registry, conversationId, credentials);
        if (acq.errorEvent) {
          writeErrorEvent(res, acq.errorEvent);
          res.end();
          return;
        }
        acquiredWorker = acq.worker;

        try {
          await runTurn({
            registry,
            worker: acquiredWorker,
            conversationId,
            prompt,
            system,
            res,
            abortSignal: abort.signal,
          });
        } catch (err) {
          // runTurn already handled session-not-found internally; any
          // other thrown error means the stream needs to be aborted so
          // its open /event connection to opencode doesn't leak.
          abort.abort();
          throw err;
        }

        // session-not-found path: runTurn wrote the error event but
        // didn't abort. Drain + end here.
        if (!res.writableEnded) {
          abort.abort();
          res.end();
        }
      } catch (err) {
        logger.error(`ERROR (${conversationId}):`, err.message);
        try {
          writeErrorEvent(res, err.message);
        } catch {}
        if (!res.writableEnded) res.end();
      } finally {
        if (acquiredWorker) acquiredWorker.inFlight = false;
      }
    });
  };
}

module.exports = {
  createWorkerRegistry,
  createChatHandler,
  makeDefaultStartWorker,
  // Exported for smoke tests that need to exercise helpers directly:
  setupWorkerHome,
  waitForReadiness,
  createOpenCodeSession,
  postMessage,
  streamSessionEvents,
  eventBelongsToSession,
  getFreePort,
  TERMINAL_EVENT_TYPES,
};
