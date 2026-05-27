// @ts-nocheck
//
// Langy manager entry point. Reads env, wires up the worker registry +
// /chat handler from manager.js, starts the HTTP server, installs the
// reaper interval, and forwards SIGTERM/SIGINT for graceful shutdown.
//
// All logic lives in manager.js — this file is the production
// composition root. Smoke harnesses skip this file and import manager.js
// directly with stubbed dependencies.
//
// HTTP API:
//   POST /chat   (Bearer ${LANGY_INTERNAL_SECRET})
//     body: { conversationId, prompt, system?, credentials: {
//              langwatchApiKey, llmVirtualKey, gatewayBaseUrl,
//              langwatchEndpoint } }
//     resp: application/x-ndjson stream of opencode events
//   GET /health
//     resp: text/plain "ok (N/MAX workers)"

const http = require("http");
const {
  createWorkerRegistry,
  createChatHandler,
  makeDefaultStartWorker,
} = require("./manager");

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
const REAPER_INTERVAL_MS = parseInt(
  process.env.LANGY_REAPER_INTERVAL_MS || "30000",
  10,
);
// Paths default to the in-pod layout. Overridable so the manager can be
// exercised against a non-pod filesystem (smoke tests, CI runners
// without /workspace).
const SESSIONS_ROOT =
  process.env.LANGY_SESSIONS_ROOT || "/workspace/sessions";
const AGENTS_TEMPLATE_PATH =
  process.env.LANGY_AGENTS_TEMPLATE_PATH || "/workspace/AGENTS.md";
const SKILLS_DIR = process.env.LANGY_SKILLS_DIR || "/workspace/skills";

if (!INTERNAL_SECRET) {
  console.error("fatal: LANGY_INTERNAL_SECRET is required");
  process.exit(1);
}

// ---------- Wire up registry + handler ----------

const startWorker = makeDefaultStartWorker({
  sessionsRoot: SESSIONS_ROOT,
  agentsTemplatePath: AGENTS_TEMPLATE_PATH,
  skillsDir: SKILLS_DIR,
  readinessTimeoutMs: READINESS_TIMEOUT_MS,
});

const registry = createWorkerRegistry({
  startWorker,
  maxWorkers: MAX_WORKERS,
  idleMs: WORKER_IDLE_MS,
});

const chatHandler = createChatHandler({
  registry,
  internalSecret: INTERNAL_SECRET,
});

// ---------- Reaper + signal handlers ----------

setInterval(() => registry.reapIdle(), REAPER_INTERVAL_MS).unref();

function shutdownAndExit(signal) {
  registry.shutdownAll(signal);
  process.exit(0);
}
process.on("SIGTERM", () => shutdownAndExit("SIGTERM"));
process.on("SIGINT", () => shutdownAndExit("SIGINT"));

// ---------- HTTP server ----------

const server = http.createServer((req, res) => {
  if (req.method === "GET" && req.url === "/health") {
    res.writeHead(200, { "Content-Type": "text/plain" });
    res.end(`ok (${registry.workers.size}/${MAX_WORKERS} workers)`);
    return;
  }
  if (req.method === "POST" && req.url === "/chat") {
    return chatHandler(req, res);
  }
  res.writeHead(404);
  res.end();
});

server.listen(PORT, () => {
  console.log(
    `langy manager listening on :${PORT}, MAX_WORKERS=${MAX_WORKERS}`,
  );
});
