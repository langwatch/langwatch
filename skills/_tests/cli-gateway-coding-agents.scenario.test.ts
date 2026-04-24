/**
 * Coding-agent gateway matrix.
 *
 * One cell per major coding CLI: claude-code, codex, gemini-cli, opencode.
 * Each cell points the CLI at the LangWatch AI Gateway via a freshly-seeded
 * matrix-{provider} virtual key, asks the agent to do a real coding task —
 * "implement a React hello world with Vite" — and verifies that the resulting
 * traces land in LangWatch with non-zero token counts, captured cost, and
 * non-zero cache-read tokens (these CLIs all aggressively cache system
 * prompts, so a multi-turn task naturally exercises the cache path).
 *
 * The React-vite task naturally exercises `tool_use` (Read, Write, Bash)
 * and `caching` (system-prompt re-send across many turns) — so this single
 * cell per CLI claims both of those scenario dimensions implicitly. Plain
 * simple/stream/structured-outputs cells live in the Lane A provider matrix
 * (services/aigateway/tests/matrix/) where they belong: the CLI's behaviour
 * isn't the unit under test, the gateway → provider plumbing is.
 *
 * Cells skip when:
 *   - The CLI binary is not on PATH
 *   - The required env (LANGWATCH_API_KEY, LANGWATCH_GATEWAY_VK_<PROVIDER>,
 *     LANGWATCH_GATEWAY_VK_<PROVIDER>_ID) is missing
 *   - CI=1 (these tests cost real money against real providers)
 *
 * On success, each cell prints a single matrix line:
 *   [matrix] cli=claude-code task=react_vite_hello_world duration=124s
 *            cost=$0.0432 cache_read=8421 file=...
 */
import { spawnSync } from "child_process";
import dotenv from "dotenv";
import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";
import { describe, expect, it } from "vitest";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.resolve(__dirname, "../.env") });

const isCI = !!process.env.CI;

const LW_BASE = process.env.LANGWATCH_ENDPOINT ?? "http://localhost:5560";
const GATEWAY_BASE = process.env.LW_GATEWAY_BASE ?? "http://localhost:5563";
const GATEWAY_BASE_V1 = `${GATEWAY_BASE}/v1`;

type ProviderName = "openai" | "anthropic" | "gemini";

/**
 * Seeded matrix VKs from scripts/seed-gateway-dogfood.ts — one per provider
 * the gateway can route to. Set in skills/_tests/.env or shell:
 *   LANGWATCH_GATEWAY_VK_OPENAI=lw_vk_test_…       LANGWATCH_GATEWAY_VK_OPENAI_ID=vk_…
 *   LANGWATCH_GATEWAY_VK_ANTHROPIC=lw_vk_test_…    LANGWATCH_GATEWAY_VK_ANTHROPIC_ID=vk_…
 *   LANGWATCH_GATEWAY_VK_GEMINI=lw_vk_test_…       LANGWATCH_GATEWAY_VK_GEMINI_ID=vk_…
 */
function vkFor(provider: ProviderName): { secret: string; id: string } | null {
  const env = provider.toUpperCase();
  const secret = process.env[`LANGWATCH_GATEWAY_VK_${env}`];
  const id = process.env[`LANGWATCH_GATEWAY_VK_${env}_ID`];
  if (!secret || !id) return null;
  return { secret, id };
}

function cliAvailable(cli: string): boolean {
  const probe = spawnSync(cli, ["--version"], {
    encoding: "utf-8",
    stdio: ["ignore", "ignore", "ignore"],
  });
  return probe.status === 0;
}

interface TraceMetrics {
  costUsd: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  traceCount: number;
}

/**
 * Polls the LangWatch traces API for traces in a time window, optionally
 * filtered client-side by a substring of the trace's input (since the
 * traces/search filter shape for span attributes — e.g. langwatch.virtual_key_id
 * — isn't exposed cleanly through the public REST endpoint today).
 *
 * A coding session fires many requests; we sum tokens + cost across them.
 */
async function assertSessionTraces(opts: {
  /** Start of the test window (used as startDate) */
  since: Date;
  /** Substring of the agent's task prompt — used to filter client-side */
  inputSubstring?: string;
  timeoutMs?: number;
  /** Caller can require minimum trace count (e.g. > 1 ensures cache had a
   * chance to warm). Default 1. */
  minTraces?: number;
}): Promise<TraceMetrics> {
  const apiKey = process.env.LANGWATCH_API_KEY;
  if (!apiKey) throw new Error("LANGWATCH_API_KEY is required");
  const timeout = opts.timeoutMs ?? 60_000;
  const minTraces = opts.minTraces ?? 1;
  const deadline = Date.now() + timeout;
  const startMs = opts.since.getTime();

  while (Date.now() < deadline) {
    const res = await fetch(`${LW_BASE}/api/traces/search`, {
      method: "POST",
      headers: {
        "X-Auth-Token": apiKey,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        startDate: startMs,
        endDate: Date.now(),
      }),
    });
    if (res.ok) {
      const body = (await res.json()) as {
        traces?: Array<{
          input?: { value?: string };
          metrics?: {
            total_cost?: number;
            prompt_tokens?: number;
            completion_tokens?: number;
            cache_read_input_tokens?: number;
          };
        }>;
      };
      const all = body.traces ?? [];
      const matching = opts.inputSubstring
        ? all.filter((t) => t.input?.value?.includes(opts.inputSubstring!))
        : all;
      if (matching.length >= minTraces) {
        const totals = matching.reduce<TraceMetrics>(
          (acc, t) => ({
            costUsd: acc.costUsd + (t.metrics?.total_cost ?? 0),
            inputTokens: acc.inputTokens + (t.metrics?.prompt_tokens ?? 0),
            outputTokens: acc.outputTokens + (t.metrics?.completion_tokens ?? 0),
            cacheReadTokens:
              acc.cacheReadTokens + (t.metrics?.cache_read_input_tokens ?? 0),
            traceCount: acc.traceCount + 1,
          }),
          {
            costUsd: 0,
            inputTokens: 0,
            outputTokens: 0,
            cacheReadTokens: 0,
            traceCount: 0,
          },
        );
        if (totals.costUsd > 0 && totals.inputTokens > 0 && totals.outputTokens > 0) {
          return totals;
        }
      }
    }
    await new Promise((r) => setTimeout(r, 2_000));
  }
  throw new Error(
    `No qualifying traces (minTraces=${minTraces}, all metrics > 0) ` +
      `${opts.inputSubstring ? `matching "${opts.inputSubstring}" ` : ""}` +
      `within ${timeout}ms`,
  );
}

function logMatrixCell(opts: {
  cli: string;
  task: string;
  durationMs: number;
  metrics: TraceMetrics;
  testFile: string;
}): void {
  // eslint-disable-next-line no-console
  console.log(
    `[matrix] cli=${opts.cli} task=${opts.task} ` +
      `duration=${(opts.durationMs / 1000).toFixed(0)}s ` +
      `traces=${opts.metrics.traceCount} ` +
      `cost=$${opts.metrics.costUsd.toFixed(4)} ` +
      `tokens_in=${opts.metrics.inputTokens} ` +
      `tokens_out=${opts.metrics.outputTokens} ` +
      `cache_read=${opts.metrics.cacheReadTokens} ` +
      `file=${opts.testFile}`,
  );
}

function assertReactViteArtifacts(workDir: string): void {
  const pkg = path.join(workDir, "package.json");
  expect(
    fs.existsSync(pkg),
    `expected package.json at ${pkg}`,
  ).toBe(true);
  const pkgJson = JSON.parse(fs.readFileSync(pkg, "utf-8")) as {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  };
  const deps = { ...pkgJson.dependencies, ...pkgJson.devDependencies };
  expect(
    deps.react ?? deps["react-dom"],
    "expected react in package.json deps",
  ).toBeDefined();
  expect(deps.vite, "expected vite in package.json deps").toBeDefined();

  // App component / entry point — agents may put it under src/App.{jsx,tsx} or
  // index.html depending on template choice. Be permissive.
  const candidates = [
    "src/App.tsx",
    "src/App.jsx",
    "src/App.js",
    "index.html",
  ];
  const found = candidates.find((c) => fs.existsSync(path.join(workDir, c)));
  expect(
    found,
    `expected one of ${candidates.join(", ")} to exist`,
  ).toBeDefined();
}

// Distinct enough to filter on traces.input.value client-side via substring
// match (the LW search REST endpoint doesn't expose span-attribute filters
// like langwatch.virtual_key_id today, so input matching is our hook).
const TASK_INPUT_MARKER = "react-vite-hello-world-matrix";
const TASK_PROMPT =
  `[task=${TASK_INPUT_MARKER}] Bootstrap a minimal React + Vite project in ` +
  "this directory: run the appropriate npm/pnpm command to scaffold it, " +
  "then make the App component render <h1>Hello World</h1>. Don't run the " +
  "dev server, just set up the project so `vite build` would work. Reply " +
  "with a one-line summary at the end.";

const TEST_FILE = "skills/_tests/cli-gateway-coding-agents.scenario.test.ts";

const skipMatrix = isCI || !process.env.LANGWATCH_API_KEY;

describe("AI Gateway — coding-agent matrix", () => {
  // ============================================================
  // claude-code (Anthropic Messages API)
  // ============================================================
  it.skipIf(skipMatrix || !cliAvailable("claude") || !vkFor("anthropic"))(
    "claude-code · React vite hello world · trace + cost + cache captured",
    async () => {
      const vk = vkFor("anthropic")!;
      const tempFolder = fs.mkdtempSync(
        path.join(os.tmpdir(), "lw-cmatrix-claude-vite-"),
      );
      const since = new Date();
      const start = Date.now();

      const result = spawnSync(
        "claude",
        [
          "--print",
          "--dangerously-skip-permissions",
          // --bare strips hooks, LSP, plugin sync, attribution, auto-memory,
          // background prefetches, keychain reads, CLAUDE.md auto-discovery.
          // Without this, the child claude inherits the parent session's
          // skills + plugins as system blocks → request body balloons past
          // Anthropic's edge tolerance → HTML 4xx response.
          "--bare",
          "--disable-slash-commands",
          // Pin to dated haiku-4.5 so we sidestep the thinking-required
          // default model claude code otherwise picks up. The dated name
          // is what Bifrost's provider registry recognises.
          "--model",
          "claude-haiku-4-5-20251001",
          TASK_PROMPT,
        ],
        {
          cwd: tempFolder,
          encoding: "utf-8",
          timeout: 600_000,
          env: {
            ...process.env,
            ANTHROPIC_BASE_URL: GATEWAY_BASE,
            ANTHROPIC_AUTH_TOKEN: vk.secret,
            ANTHROPIC_API_KEY: "",
          },
        },
      );
      if (result.status !== 0) {
        throw new Error(
          `claude exited ${result.status}\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`,
        );
      }

      assertReactViteArtifacts(tempFolder);

      const metrics = await assertSessionTraces({
        since,
        inputSubstring: TASK_INPUT_MARKER,
        minTraces: 2,
      });
      expect(metrics.cacheReadTokens, "cache_read_tokens > 0 (claude-code aggressively caches system prompts)").toBeGreaterThan(0);

      logMatrixCell({
        cli: "claude-code",
        task: "react_vite_hello_world",
        durationMs: Date.now() - start,
        metrics,
        testFile: TEST_FILE,
      });
    },
    700_000,
  );

  // ============================================================
  // codex (OpenAI)
  // ============================================================
  it.skipIf(skipMatrix || !cliAvailable("codex") || !vkFor("openai"))(
    "codex · React vite hello world · trace + cost + cache captured",
    async () => {
      const vk = vkFor("openai")!;
      const tempFolder = fs.mkdtempSync(
        path.join(os.tmpdir(), "lw-cmatrix-codex-vite-"),
      );
      const since = new Date();
      const start = Date.now();

      const result = spawnSync(
        "codex",
        [
          "exec",
          "--skip-git-repo-check",
          "--dangerously-bypass-approvals-and-sandbox",
          // Define a custom model_provider on the fly that points at the
          // gateway. Codex's default auth path uses ~/.codex/auth.json
          // (OAuth) which BYPASSES OPENAI_BASE_URL — so we can't just set
          // env vars. The -c flags override config.toml at load time.
          "-c",
          // Codex 0.122+ requires wire_api="responses" (chat is deprecated).
          // Gateway exposes POST /v1/responses with OpenAI-equivalent shape.
          `model_providers.lwgw={ name = "LangWatch Gateway", base_url = "${GATEWAY_BASE_V1}", env_key = "OPENAI_API_KEY", wire_api = "responses" }`,
          "-c",
          "model_provider=lwgw",
          // Pin to gpt-4o-mini — codex's default gpt-5.4 isn't on Bifrost's
          // Responses-API model registry yet. gpt-4o-mini is recognised
          // and cheap.
          "-c",
          'model="gpt-4o-mini"',
          "-c",
          'model_reasoning_effort="low"',
          TASK_PROMPT,
        ],
        {
          cwd: tempFolder,
          encoding: "utf-8",
          timeout: 600_000,
          env: {
            ...process.env,
            OPENAI_API_KEY: vk.secret,
          },
        },
      );
      if (result.status !== 0) {
        throw new Error(
          `codex exited ${result.status}\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`,
        );
      }

      assertReactViteArtifacts(tempFolder);

      const metrics = await assertSessionTraces({
        since,
        inputSubstring: TASK_INPUT_MARKER,
        minTraces: 2,
      });
      expect(metrics.cacheReadTokens, "cache_read_tokens > 0 (OpenAI auto-caches >=1024-token prefixes)").toBeGreaterThan(0);

      logMatrixCell({
        cli: "codex",
        task: "react_vite_hello_world",
        durationMs: Date.now() - start,
        metrics,
        testFile: TEST_FILE,
      });
    },
    700_000,
  );

  // ============================================================
  // gemini-cli (Google Gemini API)
  //
  // gemini-cli does NOT support a per-invocation API endpoint override — it
  // always points at generativelanguage.googleapis.com. Routing it through
  // the LangWatch gateway requires either:
  //   (a) an upstream gemini-cli base-url flag (issue open in
  //       google-gemini/gemini-cli)
  //   (b) a wrapper script that intercepts and proxies, OR
  //   (c) /etc/hosts override for generativelanguage.googleapis.com
  //
  // For now this cell t.skips with a clear reason. Once upstream lands the
  // base-url flag we can flip the assertion shape to match the others.
  // ============================================================
  it.skip(
    "gemini-cli · React vite hello world · trace + cost + cache captured · BLOCKED on upstream base-url flag",
    () => {
      // No-op until gemini-cli adds endpoint override.
    },
  );

  // ============================================================
  // opencode (multi-provider, openai by default)
  // ============================================================
  it.skipIf(skipMatrix || !cliAvailable("opencode") || !vkFor("openai"))(
    "opencode · React vite hello world · trace + cost + cache captured",
    async () => {
      const vk = vkFor("openai")!;
      const tempFolder = fs.mkdtempSync(
        path.join(os.tmpdir(), "lw-cmatrix-opencode-vite-"),
      );
      const configDir = path.join(tempFolder, "opencode-config");
      fs.mkdirSync(configDir, { recursive: true });
      fs.writeFileSync(
        path.join(configDir, "opencode.json"),
        JSON.stringify(
          {
            $schema: "https://opencode.ai/config.json",
            provider: {
              openai: {
                baseURL: GATEWAY_BASE_V1,
                apiKey: vk.secret,
              },
            },
            model: "openai/gpt-5-mini",
          },
          null,
          2,
        ),
      );

      const since = new Date();
      const start = Date.now();
      const result = spawnSync("opencode", ["run", TASK_PROMPT], {
        cwd: tempFolder,
        encoding: "utf-8",
        timeout: 600_000,
        env: {
          ...process.env,
          OPENCODE_CONFIG_HOME: configDir,
          OPENAI_API_KEY: "",
        },
      });
      if (result.status !== 0) {
        throw new Error(
          `opencode exited ${result.status}\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`,
        );
      }

      assertReactViteArtifacts(tempFolder);

      const metrics = await assertSessionTraces({
        since,
        inputSubstring: TASK_INPUT_MARKER,
        minTraces: 2,
      });
      expect(metrics.cacheReadTokens, "cache_read_tokens > 0 (OpenAI auto-caches >=1024-token prefixes)").toBeGreaterThan(0);

      logMatrixCell({
        cli: "opencode",
        task: "react_vite_hello_world",
        durationMs: Date.now() - start,
        metrics,
        testFile: TEST_FILE,
      });
    },
    700_000,
  );
});
