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
const MAX_BODY_BYTES = 1_000_000; // 1MB — cap /chat body to avoid memory exhaustion.

// opencode has no native OpenTelemetry export, so each worker loads this
// opencode plugin to emit session/llm/tool spans over OTLP. Version is pinned
// by the Dockerfile (OPENCODE_OTEL_PLUGIN_VERSION) so the version opencode
// loads matches the one baked into the image; the literal default keeps the
// manager runnable outside the image.
const OPENCODE_OTEL_PLUGIN = `@devtheops/opencode-plugin-otel@${
  process.env.OPENCODE_OTEL_PLUGIN_VERSION || "1.0.0"
}`;

if (!INTERNAL_SECRET) {
  console.error("fatal: LANGY_INTERNAL_SECRET is required");
  process.exit(1);
}

// ---------- Worker registry ----------
// conversationId -> { child, port, openCodeSessionId, lastSeen }
const workers = new Map();
// conversationId -> in-flight spawnWorker() promise. Serializes creation so
// two concurrent first-turn requests for the same conversation can't both miss
// workers.get() and spawn duplicate (orphan) workers that bypass the cap.
const workerSpawns = new Map();
// Atomic slot reservation for spawnWorker(). Incremented synchronously BEFORE
// the first await so concurrent first-turns for N distinct conversations can't
// all see `workers.size === 0` and all pass the cap check. Decremented in the
// spawn's finally, succeed or fail. The cap predicate is
// `workers.size + pendingSpawns >= MAX_WORKERS`.
let pendingSpawns = 0;

// Restrict conversationId to a filesystem-safe charset before it ever reaches
// path.join — otherwise values like "../../etc" escape SESSIONS_ROOT.
function isValidConversationId(value) {
  return typeof value === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(value);
}

async function getOrCreateWorker(conversationId, credentials) {
  const existing = workers.get(conversationId);
  if (existing) return existing;

  const inflight = workerSpawns.get(conversationId);
  if (inflight) return inflight;

  const spawnPromise = spawnWorker(conversationId, credentials).finally(() => {
    workerSpawns.delete(conversationId);
  });
  workerSpawns.set(conversationId, spawnPromise);
  return spawnPromise;
}

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
    model: credentials.model || "openai/gpt-5-mini",
    // OTel plugin: opencode auto-loads it by name and exports spans using the
    // OPENCODE_OTLP_* env injected at spawn time (see spawnWorker).
    plugin: [OPENCODE_OTEL_PLUGIN],
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
  // Thread the disconnect signal into the upstream fetch itself, not just the
  // reader.cancel() listener — a fetch waiting on the SSE socket would
  // otherwise stay alive after a client disconnect until OpenCode happens to
  // send a byte. With { signal } the fetch errors as AbortError immediately
  // and the catch below absorbs it.
  const eventRes = await fetch(`http://127.0.0.1:${port}/event`, { signal });
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

async function spawnWorker(conversationId, credentials) {
  // Atomic capacity reservation: must increment BEFORE any await, otherwise
  // 50 distinct conversations all observe `workers.size === 0` at the cap
  // check and all start subprocesses (memory cap defeated precisely during
  // the burst it exists to handle).
  if (workers.size + pendingSpawns >= MAX_WORKERS) {
    const err = new Error("max-workers-reached");
    err.code = "max-workers-reached";
    throw err;
  }
  pendingSpawns++;
  try {
    return await spawnWorkerInner(conversationId, credentials);
  } finally {
    pendingSpawns--;
  }
}

async function spawnWorkerInner(conversationId, credentials) {
  const workerHome = path.join(SESSIONS_ROOT, conversationId);
  // Defense-in-depth: even with isValidConversationId at the edge, assert the
  // resolved path stays under SESSIONS_ROOT before we mkdir/spawn into it.
  const resolvedRoot = path.resolve(SESSIONS_ROOT);
  if (!path.resolve(workerHome).startsWith(`${resolvedRoot}${path.sep}`)) {
    throw new Error("invalid conversationId");
  }
  fs.mkdirSync(workerHome, { recursive: true });
  setupWorkerHome(workerHome, credentials);

  const port = await getFreePort();

  // cwd + HOME both point at workerHome so opencode reads the per-worker
  // AGENTS.md (with concrete URLs) and per-worker config (with the right
  // MCP env). Env vars carry the per-session credentials redundantly so
  // the MCP server gets them via env OR via config.json — defense in depth.
  // Strip manager-side secrets from the worker env — workers never call back
  // into the manager, and forwarding them would break the per-session
  // isolation boundary this whole process model exists to enforce. Pattern-
  // based so a secret added to the pod env later doesn't silently flow into
  // every untrusted worker; the credentials a worker DOES need are injected
  // explicitly below (after the spread, so they always win).
  const SENSITIVE_ENV_RE =
    /^(LANGY_INTERNAL_SECRET$|GITHUB_LANGY_|CREDENTIALS_SECRET$|NEXTAUTH_|DATABASE_URL$|AWS_SECRET_)/;
  const baseEnv = Object.fromEntries(
    Object.entries(process.env).filter(([k]) => !SENSITIVE_ENV_RE.test(k)),
  );

  const child = spawn(
    "opencode",
    ["serve", "--port", String(port), "--hostname", "127.0.0.1"],
    {
      env: {
        ...baseEnv,
        HOME: workerHome,
        OPENAI_BASE_URL: credentials.gatewayBaseUrl,
        OPENAI_API_KEY: credentials.llmVirtualKey,
        LANGWATCH_API_KEY: credentials.langwatchApiKey,
        LANGWATCH_ENDPOINT: credentials.langwatchEndpoint,
        // OTel export (consumed by the opencode OTel plugin, not opencode
        // itself). The plugin appends "/v1/traces" to the endpoint, so we point
        // it at the "/api/otel" base — LangWatch ingests at /api/otel/v1/traces.
        // http/protobuf is what that endpoint accepts; auth is the dedicated
        // Langy key as a Bearer token (resolves its own project, no X-Project-Id
        // needed). tag.tags=langy becomes the trace label and the conversation
        // id groups the chat's turns as one thread. conversationId is charset-
        // validated upstream, so it is safe in the comma/= delimited value.
        OPENCODE_ENABLE_TELEMETRY: "1",
        OPENCODE_OTLP_ENDPOINT: `${credentials.langwatchEndpoint.replace(
          /\/+$/,
          "",
        )}/api/otel`,
        OPENCODE_OTLP_PROTOCOL: "http/protobuf",
        OPENCODE_OTLP_HEADERS: `Authorization=Bearer ${credentials.langwatchApiKey}`,
        OPENCODE_RESOURCE_ATTRIBUTES: `tag.tags=langy,service.name=langy-agent,langwatch.thread.id=${conversationId}`,
        // Per-user GitHub user-to-server token, minted server-side by
        // LangyCredentialService and rotated every ~8h. Read by `gh` via
        // GH_TOKEN; the github.md skill wires `credential.helper` to
        // `!gh auth git-credential` so git pushes pick it up from env only.
        // Absent when the user hasn't connected — the skill then tells them
        // to connect instead of erroring.
        ...(credentials.githubToken
          ? {
              GH_TOKEN: credentials.githubToken,
              GITHUB_LOGIN: credentials.githubLogin ?? "",
            }
          : {}),
      },
      cwd: workerHome,
      stdio: ["ignore", "inherit", "inherit"],
    },
  );

  child.on("exit", (code, signal) => {
    console.log(
      `worker ${conversationId} exited (code=${code}, signal=${signal})`,
    );
    workers.delete(conversationId);
    removeWorkerHome(conversationId);
  });

  try {
    await waitForReadiness(port, READINESS_TIMEOUT_MS);
  } catch (err) {
    try {
      child.kill("SIGTERM");
    } catch {}
    throw err;
  }

  const openCodeSessionId = await createOpenCodeSession(port);

  const info = { child, port, openCodeSessionId, lastSeen: Date.now() };
  workers.set(conversationId, info);
  console.log(
    `worker ${conversationId} ready on :${port} (session ${openCodeSessionId})`,
  );
  return info;
}

// Delete the per-worker home (config.json holds the plaintext LangWatch API
// key; $HOME/work holds cloned repos). Without this, secrets and clones
// accumulate on the pod volume forever — the github.md skill's "the idle
// reaper cleans it with the session" guarantee lives HERE.
function removeWorkerHome(conversationId) {
  if (!isValidConversationId(conversationId)) return;
  const workerHome = path.join(SESSIONS_ROOT, conversationId);
  const resolvedRoot = path.resolve(SESSIONS_ROOT);
  if (!path.resolve(workerHome).startsWith(`${resolvedRoot}${path.sep}`)) {
    return;
  }
  try {
    fs.rmSync(workerHome, { recursive: true, force: true });
  } catch (err) {
    console.error(`failed to remove worker home ${conversationId}:`, err.message);
  }
}

function killWorker(conversationId, reason) {
  const w = workers.get(conversationId);
  if (!w) return;
  console.log(`killing worker ${conversationId}: ${reason}`);
  try {
    w.child.kill("SIGTERM");
  } catch {}
  // The exit handler removes from map; force-clean here in case it races.
  workers.delete(conversationId);
  // The exit handler also rm's the home, but if SIGTERM is ignored or the
  // child already died without firing it, clean up here too (idempotent).
  removeWorkerHome(conversationId);
}

setInterval(() => {
  const cutoff = Date.now() - WORKER_IDLE_MS;
  for (const [convId, w] of workers) {
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
    let tooLarge = false;
    req.on("data", (c) => {
      if (tooLarge) return;
      body += c;
      if (Buffer.byteLength(body, "utf8") > MAX_BODY_BYTES) {
        tooLarge = true;
        res.writeHead(413, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "request body too large" }));
        req.destroy();
      }
    });
    req.on("end", async () => {
      if (tooLarge) return;
      let parsed;
      try {
        parsed = JSON.parse(body);
      } catch {
        badRequest(res, "invalid JSON body");
        return;
      }

      const { conversationId, prompt, system, credentials, modelOverride } =
        parsed;
      if (!conversationId || !prompt || !credentials) {
        badRequest(res, "missing required: conversationId, prompt, credentials");
        return;
      }
      if (!isValidConversationId(conversationId)) {
        badRequest(res, "invalid conversationId");
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

      // Thread the user-selected/resolved model (already validated against the
      // project's allow-list by the control plane) into the worker config so the
      // picker actually takes effect; fall back to the default otherwise. The
      // model is bound at worker creation, i.e. fixed per conversation.
      if (typeof modelOverride === "string" && modelOverride.trim()) {
        credentials.model = modelOverride.trim();
      }

      res.writeHead(200, {
        "Content-Type": "application/x-ndjson",
        "Cache-Control": "no-cache",
      });

      // Cancel the OpenCode event stream if the client actually disconnects.
      //
      // `req.on("close")` would fire as soon as the request body has been read
      // (i.e. immediately after the JSON body parsing above), not when the
      // client closes the connection — that aborts a healthy response stream
      // mid-flight or, if the listener attaches after `end`, never runs at
      // all. The reliable signal is `res.on("close")` guarded by
      // `res.writableFinished`, which only stays unset when the connection
      // closes before res.end() — i.e. an actual disconnect.
      const abort = new AbortController();
      res.on("close", () => {
        if (!res.writableFinished) abort.abort();
      });

      try {
        let worker;
        try {
          worker = await getOrCreateWorker(conversationId, credentials);
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
        worker.lastSeen = Date.now();

        const streamPromise = streamSessionEvents(
          worker.port,
          worker.openCodeSessionId,
          res,
          abort.signal,
        );

        try {
          await postMessage(
            worker.port,
            worker.openCodeSessionId,
            system,
            prompt,
          );
        } catch (err) {
          if (err.code === "session-not-found") {
            // Worker's internal opencode session vanished mid-turn (rare —
            // happens if opencode garbage-collects sessions on its own).
            // Kill the worker so the next request gets a fresh one.
            killWorker(conversationId, "opencode session vanished");
            res.write(
              JSON.stringify({ type: "error", error: "session-not-found" }) +
                "\n",
            );
            res.end();
            return;
          }
          throw err;
        }

        await streamPromise;
        res.end();
      } catch (err) {
        console.error(`ERROR (${conversationId}):`, err.message);
        try {
          res.write(
            JSON.stringify({ type: "error", error: err.message }) + "\n",
          );
        } catch {}
        res.end();
      }
    });
    return;
  }

  res.writeHead(404);
  res.end();
});

// Wipe stale per-session worker homes left by a previous manager that crashed
// or was killed before its per-worker cleanup ran. /workspace is an emptyDir
// that survives container restarts in the same pod, so plaintext per-session
// credentials and cloned repos could otherwise persist indefinitely. Do this
// before accepting traffic.
try {
  fs.rmSync(SESSIONS_ROOT, { recursive: true, force: true });
} catch {
  /* best-effort: a missing dir is fine */
}
fs.mkdirSync(SESSIONS_ROOT, { recursive: true });

server.listen(PORT, () => {
  console.log(
    `langy manager listening on :${PORT}, MAX_WORKERS=${MAX_WORKERS}`,
  );
});
