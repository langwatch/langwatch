// @vitest-environment node

/**
 * Phase 11 — CLI wrapper e2e suite.
 *
 * Pure-Node harness — no Docker, no live LLM, no langwatch-server.
 * Spins up a fake control-plane + fake gateway in-process, drops
 * shell-script "tool stubs" (claude/codex/opencode/cursor/gemini)
 * on a tmp PATH, spawns the compiled langwatch CLI as a child, and
 * asserts on:
 *
 *   1. Login config write — `langwatch login` ceremony lands a
 *      GovernanceConfig the wrapper can read on next invocation.
 *   2. Env injection — `langwatch <tool>` spawns the underlying tool
 *      with the right per-provider env vars set to gateway-base-url
 *      + personal-VK secret.
 *   3. Routing — when a tool stub actually issues an HTTP request
 *      using its injected env vars, the request lands at the fake
 *      gateway with the expected path + Authorization header.
 *   4. Budget pre-check — if the control-plane returns 402 on the
 *      pre-flight check, the wrapper exits 2 BEFORE spawning the
 *      tool; under-limit case spawns normally.
 *   5. Tool-not-found — clear error + exit 127 when the binary
 *      isn't on PATH.
 *   6. Exit-code propagation — wrapper transparently returns the
 *      child's exit code.
 *
 * Spec: specs/ai-governance/cli-wrappers/wrap-login-routing.feature
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as http from "node:http";
import { spawn } from "node:child_process";

// ─────────────────────────────────────────────────────────────────
// Harness state
// ─────────────────────────────────────────────────────────────────
let cpServer: http.Server;
let gwServer: http.Server;
let cpUrl: string;
let gwUrl: string;
let recordedGwRequests: Array<{
  path: string;
  method: string;
  authorization: string;
  body: string;
}> = [];
let cpBudgetResponse: { status: number; body: unknown } = {
  status: 200,
  body: { ok: true },
};
let tmpRoot: string;
let toolStubsDir: string;
let configPath: string;
const cliPath = path.resolve(__dirname, "../../../dist/cli/index.js");

const TEST_VK = "lw_vk_test_xyz_phase11";
const TEST_ACCESS_TOKEN = "lw_at_test_phase11";

// ─────────────────────────────────────────────────────────────────
// Fake servers
// ─────────────────────────────────────────────────────────────────
async function startFakeGateway(): Promise<{ server: http.Server; url: string }> {
  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      recordedGwRequests.push({
        path: req.url ?? "",
        method: req.method ?? "",
        authorization: (req.headers.authorization as string) ?? "",
        body,
      });
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ id: "fake-gw-resp", choices: [], usage: {} }));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as { port: number }).port;
  return { server, url: `http://127.0.0.1:${port}` };
}

async function startFakeControlPlane(): Promise<{
  server: http.Server;
  url: string;
}> {
  const server = http.createServer((req, res) => {
    if (req.url === "/api/auth/cli/budget/status") {
      res.writeHead(cpBudgetResponse.status, {
        "content-type": "application/json",
      });
      res.end(JSON.stringify(cpBudgetResponse.body));
      return;
    }
    res.writeHead(404, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "not_found", path: req.url }));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as { port: number }).port;
  return { server, url: `http://127.0.0.1:${port}` };
}

// ─────────────────────────────────────────────────────────────────
// Tool stubs (shell scripts that echo env or POST to gateway)
// ─────────────────────────────────────────────────────────────────

/**
 * Writes a shell-script "stub" for a wrapped tool. Modes:
 *   - "echo-env": prints every governance-relevant env var the
 *     wrapper might inject, one per line, then exits 0.
 *   - "post-anthropic": POSTs to ${ANTHROPIC_BASE_URL}/v1/messages
 *     with header `Authorization: Bearer ${ANTHROPIC_AUTH_TOKEN}`.
 *   - "post-openai": POSTs to ${OPENAI_BASE_URL}/v1/chat/completions
 *     with header `Authorization: Bearer ${OPENAI_API_KEY}`.
 *   - "exit-code:<n>": exits with code n (transparency check).
 */
function writeToolStub(name: string, mode: string): void {
  const scriptPath = path.join(toolStubsDir, name);
  let body = "#!/bin/bash\nset -e\n";
  if (mode === "echo-env") {
    body +=
      'for var in ANTHROPIC_BASE_URL ANTHROPIC_AUTH_TOKEN OPENAI_BASE_URL OPENAI_API_KEY GOOGLE_GENAI_API_BASE GEMINI_API_KEY; do\n' +
      '  printf "%s=%s\\n" "$var" "${!var:-}"\n' +
      'done\n';
  } else if (mode === "post-anthropic") {
    body +=
      'curl -s -X POST -H "Authorization: Bearer ${ANTHROPIC_AUTH_TOKEN}" ' +
      '-H "content-type: application/json" ' +
      '-d \'{"model":"claude-test","messages":[]}\' ' +
      '"${ANTHROPIC_BASE_URL}/v1/messages" > /dev/null\n';
  } else if (mode === "post-openai") {
    body +=
      'curl -s -X POST -H "Authorization: Bearer ${OPENAI_API_KEY}" ' +
      '-H "content-type: application/json" ' +
      '-d \'{"model":"gpt-test","messages":[]}\' ' +
      '"${OPENAI_BASE_URL}/v1/chat/completions" > /dev/null\n';
  } else if (mode.startsWith("exit-code:")) {
    const code = mode.slice("exit-code:".length);
    body += `exit ${code}\n`;
  } else {
    throw new Error(`unknown stub mode: ${mode}`);
  }
  fs.writeFileSync(scriptPath, body, { mode: 0o755 });
}

function clearToolStubs(): void {
  for (const f of fs.readdirSync(toolStubsDir)) {
    fs.unlinkSync(path.join(toolStubsDir, f));
  }
}

// ─────────────────────────────────────────────────────────────────
// CLI runner
// ─────────────────────────────────────────────────────────────────
interface RunOpts {
  /** Whether to include toolStubsDir on PATH (off → simulates "binary not installed"). */
  includeToolStubs?: boolean;
}

interface RunResult {
  status: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
}

/**
 * Spawn the CLI as an ASYNC child process. This is critical: when the
 * test harness hosts the fake control-plane / fake gateway in the same
 * vitest worker, a synchronous `spawnSync` blocks the worker's event
 * loop, so the in-process HTTP server never responds to the child's
 * fetch — the child waits forever, spawnSync times out. Using async
 * `spawn` keeps the worker's event loop free to serve the fake
 * servers while the child runs.
 */
function runCli(args: string[], opts: RunOpts = {}): Promise<RunResult> {
  const includeStubs = opts.includeToolStubs ?? true;
  // PATH composition is delicate:
  //  - When stubs are included, prepend toolStubsDir so our shell-script
  //    stubs win over any real binaries on the dev machine (the wrapper
  //    routes through `claude`/`codex`/etc., and the developer running
  //    these tests likely has the real binaries installed).
  //  - When stubs are EXCLUDED (the "tool-not-found" scenario), we need
  //    a PATH that does NOT contain the real binaries at all — otherwise
  //    spawn() finds the real `claude` and exec's it, and the test
  //    asserts the wrong outcome. We strip user-installed-tool paths
  //    (~/.nvm/.../bin, ~/.local/bin, /usr/local/bin) and keep only
  //    the bash/curl essentials at /usr/bin:/bin.
  const inheritedPath = process.env.PATH ?? "/usr/bin:/bin";
  const pathValue = includeStubs
    ? `${toolStubsDir}:${inheritedPath}`
    : "/usr/bin:/bin";
  // Build a minimal env: keep PATH + HOME + a small allowlist; drop
  // every VITEST_*/NODE_* variable that vitest's worker injects (some
  // of them — e.g. NODE_V8_COVERAGE — cause the spawned child to
  // mis-interact with vitest's IPC channel and hang on exit).
  const allowKeys = new Set([
    "HOME",
    "TMPDIR",
    "USER",
    "LOGNAME",
    "LANG",
    "LC_ALL",
    "SHELL",
    "TERM",
  ]);
  const env: Record<string, string> = {};
  for (const k of allowKeys) {
    const v = process.env[k];
    if (v !== undefined) env[k] = v;
  }
  env.PATH = pathValue;
  env.LANGWATCH_CLI_CONFIG = configPath;
  env.LANGWATCH_GOVERNANCE_PREVIEW = "1";
  env.LANGWATCH_ENDPOINT = cpUrl;
  env.LANGWATCH_GATEWAY_URL = gwUrl;
  // Detach stdin from the vitest worker — passing "ignore" means the
  // child gets /dev/null on fd 0, which prevents any inherited stdio
  // from blocking exit. stdout/stderr are pipes so we can capture
  // them. cwd is forced to a clean tmp dir so dotenv.config() doesn't
  // pick up the typescript-sdk's own .env.
  return new Promise<RunResult>((resolve) => {
    // Use process.execPath (absolute path to running node binary)
    // instead of bare "node" so the tool-not-found scenario can use a
    // minimal PATH (/usr/bin:/bin) without losing the ability to launch
    // the CLI.
    const child = spawn(process.execPath, [cliPath, ...args], {
      env,
      cwd: tmpRoot,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => (stdout += chunk));
    child.stderr.on("data", (chunk: string) => (stderr += chunk));
    const killer = setTimeout(() => {
      child.kill("SIGKILL");
    }, 20_000);
    child.on("close", (code, signal) => {
      clearTimeout(killer);
      resolve({ status: code, signal: signal, stdout, stderr });
    });
  });
}

function writeLoggedInConfig(): void {
  const cfg = {
    gateway_url: gwUrl,
    control_plane_url: cpUrl,
    access_token: TEST_ACCESS_TOKEN,
    refresh_token: "lw_rt_test_phase11",
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    user: { id: "user_phase11", email: "phase11@acme.test" },
    organization: { id: "org_phase11", slug: "acme", name: "ACME" },
    default_personal_vk: {
      id: "vk_phase11",
      secret: TEST_VK,
      prefix: "lw_vk_t",
    },
  };
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  fs.writeFileSync(configPath, JSON.stringify(cfg, null, 2), { mode: 0o600 });
}

function writeLoggedOutConfig(): void {
  // No file at all — loadConfig returns defaults() which has no access_token.
  if (fs.existsSync(configPath)) fs.unlinkSync(configPath);
}

function readConfig(): Record<string, unknown> {
  return JSON.parse(fs.readFileSync(configPath, "utf8")) as Record<
    string,
    unknown
  >;
}

// ─────────────────────────────────────────────────────────────────
// Lifecycle
// ─────────────────────────────────────────────────────────────────
beforeAll(async () => {
  if (!fs.existsSync(cliPath)) {
    throw new Error(
      `CLI not built at ${cliPath} — run \`pnpm build\` in typescript-sdk/ before this suite`,
    );
  }
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "lw-gov-e2e-"));
  toolStubsDir = path.join(tmpRoot, "stubs");
  fs.mkdirSync(toolStubsDir, { recursive: true });
  configPath = path.join(tmpRoot, "config.json");

  const gw = await startFakeGateway();
  gwServer = gw.server;
  gwUrl = gw.url;

  const cp = await startFakeControlPlane();
  cpServer = cp.server;
  cpUrl = cp.url;
});

afterAll(async () => {
  await new Promise<void>((r) => gwServer.close(() => r()));
  await new Promise<void>((r) => cpServer.close(() => r()));
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

beforeEach(() => {
  recordedGwRequests = [];
  cpBudgetResponse = { status: 200, body: { ok: true } };
  if (fs.existsSync(toolStubsDir)) clearToolStubs();
  if (fs.existsSync(configPath)) fs.unlinkSync(configPath);
});

afterEach(() => {
  if (fs.existsSync(toolStubsDir)) clearToolStubs();
});

// ─────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────
function envFromStub(stdout: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of stdout.split("\n")) {
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    out[line.slice(0, eq)] = line.slice(eq + 1).trim();
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────
describe("governance CLI wrappers — Phase 11 e2e", () => {
  describe("login state gating", () => {
    describe("when not logged in", () => {
      it("exits 1 with `Not logged in` on `langwatch claude` and never spawns the tool", async () => {
        writeLoggedOutConfig();
        writeToolStub("claude", "echo-env");
        const res = await runCli(["claude"]);
        expect(res.status).toBe(1);
        const combined = (res.stdout ?? "") + (res.stderr ?? "");
        expect(combined).toMatch(/Not logged in/);
        expect(combined).toMatch(/langwatch login --device/);
        // tool stub never wrote any env-line to stdout
        expect(res.stdout ?? "").not.toMatch(/^ANTHROPIC_BASE_URL=/m);
      });
    });
  });

  describe("env injection — per-tool standard env vars", () => {
    describe.each([
      {
        tool: "claude",
        expected: {
          ANTHROPIC_BASE_URL: "/api/v1/anthropic",
          ANTHROPIC_AUTH_TOKEN: TEST_VK,
        },
        mustNotInject: ["OPENAI_BASE_URL", "GOOGLE_GENAI_API_BASE"],
      },
      {
        tool: "codex",
        expected: {
          OPENAI_BASE_URL: "/api/v1/openai",
          OPENAI_API_KEY: TEST_VK,
        },
        mustNotInject: ["ANTHROPIC_BASE_URL", "GOOGLE_GENAI_API_BASE"],
      },
      {
        tool: "opencode",
        expected: {
          OPENAI_BASE_URL: "/api/v1/openai",
          OPENAI_API_KEY: TEST_VK,
          ANTHROPIC_BASE_URL: "/api/v1/anthropic",
          ANTHROPIC_AUTH_TOKEN: TEST_VK,
        },
        mustNotInject: ["GOOGLE_GENAI_API_BASE", "GEMINI_API_KEY"],
      },
      {
        tool: "cursor",
        expected: {
          OPENAI_BASE_URL: "/api/v1/openai",
          OPENAI_API_KEY: TEST_VK,
          ANTHROPIC_BASE_URL: "/api/v1/anthropic",
          ANTHROPIC_AUTH_TOKEN: TEST_VK,
        },
        mustNotInject: ["GOOGLE_GENAI_API_BASE", "GEMINI_API_KEY"],
      },
      {
        tool: "gemini",
        expected: {
          GOOGLE_GENAI_API_BASE: "/api/v1/gemini",
          GEMINI_API_KEY: TEST_VK,
        },
        mustNotInject: ["ANTHROPIC_BASE_URL", "OPENAI_BASE_URL"],
      },
    ])(
      "when running `langwatch $tool`",
      ({ tool, expected, mustNotInject }) => {
        it(`spawns ${tool} with the documented provider env vars and no unrelated ones`, async () => {
          writeLoggedInConfig();
          writeToolStub(tool, "echo-env");
          const res = await runCli([tool]);
          expect(res.status).toBe(0);
          const env = envFromStub(res.stdout ?? "");
          for (const [k, suffix] of Object.entries(expected)) {
            if (suffix.startsWith("/")) {
              expect(env[k]).toBe(`${gwUrl}${suffix}`);
            } else {
              expect(env[k]).toBe(suffix);
            }
          }
          for (const k of mustNotInject) {
            expect(env[k] ?? "").toBe("");
          }
        });
      },
    );
  });

  describe("routing — wrapped tool's HTTP traffic lands at the gateway with the VK", async () => {
    describe("when wrapped claude POSTs to ${ANTHROPIC_BASE_URL}/v1/messages", () => {
      it("the fake gateway records the request at /api/v1/anthropic/v1/messages with Bearer VK", async () => {
        writeLoggedInConfig();
        writeToolStub("claude", "post-anthropic");
        const res = await runCli(["claude"]);
        expect(res.status).toBe(0);
        expect(recordedGwRequests).toHaveLength(1);
        expect(recordedGwRequests[0]!.method).toBe("POST");
        expect(recordedGwRequests[0]!.path).toBe(
          "/api/v1/anthropic/v1/messages",
        );
        expect(recordedGwRequests[0]!.authorization).toBe(`Bearer ${TEST_VK}`);
      });
    });

    describe("when wrapped codex POSTs to ${OPENAI_BASE_URL}/v1/chat/completions", () => {
      it("the fake gateway records the request at /api/v1/openai/v1/chat/completions with Bearer VK", async () => {
        writeLoggedInConfig();
        writeToolStub("codex", "post-openai");
        const res = await runCli(["codex"]);
        expect(res.status).toBe(0);
        expect(recordedGwRequests).toHaveLength(1);
        expect(recordedGwRequests[0]!.path).toBe(
          "/api/v1/openai/v1/chat/completions",
        );
        expect(recordedGwRequests[0]!.authorization).toBe(`Bearer ${TEST_VK}`);
      });
    });

    describe("when wrapped opencode POSTs through OpenAI-compatible env vars", () => {
      it("the fake gateway records the request at /api/v1/openai/v1/chat/completions with Bearer VK", async () => {
        writeLoggedInConfig();
        writeToolStub("opencode", "post-openai");
        const res = await runCli(["opencode"]);
        expect(res.status).toBe(0);
        expect(recordedGwRequests).toHaveLength(1);
        expect(recordedGwRequests[0]!.path).toBe(
          "/api/v1/openai/v1/chat/completions",
        );
        expect(recordedGwRequests[0]!.authorization).toBe(`Bearer ${TEST_VK}`);
      });
    });
  });

  describe("budget pre-check", () => {
    describe("when the control-plane returns 402 budget_exceeded", () => {
      it("exits 2 BEFORE spawning the tool and stamps last_request_increase_url", async () => {
        writeLoggedInConfig();
        writeToolStub("claude", "echo-env");
        cpBudgetResponse = {
          status: 402,
          body: {
            error: {
              type: "budget_exceeded",
              scope: "user",
              limit_usd: "10.00",
              spent_usd: "10.50",
              period: "month",
              request_increase_url:
                "http://app.test/orgs/acme/governance/personal-portal?token=abc",
              admin_email: "admin@acme.test",
            },
          },
        };
        const res = await runCli(["claude"]);
        expect(res.status).toBe(2);
        const combined = (res.stdout ?? "") + (res.stderr ?? "");
        expect(combined).toMatch(/Budget limit reached/);
        expect(combined).toMatch(/\$10\.50.*\$10\.00.*monthly/);
        expect(combined).toMatch(/langwatch request-increase/);
        // tool stub did NOT run (no env line in stdout)
        expect(res.stdout ?? "").not.toMatch(/^ANTHROPIC_BASE_URL=/m);
        // last_request_increase_url persisted
        const cfg = readConfig();
        expect(cfg.last_request_increase_url).toBe(
          "http://app.test/orgs/acme/governance/personal-portal?token=abc",
        );
      });
    });

    describe("when the control-plane returns 200 (under-limit)", () => {
      it("spawns the tool with normal env injection", async () => {
        writeLoggedInConfig();
        writeToolStub("claude", "echo-env");
        cpBudgetResponse = { status: 200, body: { ok: true } };
        const res = await runCli(["claude"]);
        expect(res.status).toBe(0);
        const env = envFromStub(res.stdout ?? "");
        expect(env.ANTHROPIC_BASE_URL).toBe(`${gwUrl}/api/v1/anthropic`);
      });
    });

    describe("when the control-plane is unreachable / 5xx", () => {
      it("does NOT block the user (passes through to the wrapped tool)", async () => {
        writeLoggedInConfig();
        writeToolStub("claude", "echo-env");
        cpBudgetResponse = { status: 500, body: { error: "down" } };
        const res = await runCli(["claude"]);
        expect(res.status).toBe(0);
        const env = envFromStub(res.stdout ?? "");
        expect(env.ANTHROPIC_BASE_URL).toBe(`${gwUrl}/api/v1/anthropic`);
      });
    });
  });

  describe("tool-not-found handling", () => {
    describe("when the underlying binary is not on PATH", () => {
      it("exits 127 with a clear actionable error", async () => {
        writeLoggedInConfig();
        // intentionally do NOT writeToolStub — and exclude stubs from PATH
        const res = await runCli(["claude"], { includeToolStubs: false });
        expect(res.status).toBe(127);
        const combined = (res.stdout ?? "") + (res.stderr ?? "");
        expect(combined).toMatch(/claude not found in PATH/);
        expect(combined).toMatch(/install it first/);
      });
    });
  });

  describe("exit-code propagation", () => {
    describe.each([
      { tool: "claude", code: 0 },
      { tool: "codex", code: 1 },
      { tool: "claude", code: 42 },
    ])("when wrapped $tool exits with $code", ({ tool, code }) => {
      it("the wrapper exits with the same code", async () => {
        writeLoggedInConfig();
        writeToolStub(tool, `exit-code:${code}`);
        const res = await runCli([tool]);
        expect(res.status).toBe(code);
      });
    });
  });
});
