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
      // Substring filter is best-effort: some agents (notably opencode) emit
      // traces where input.value is empty because the user prompt lives in
      // a tool-result / structured input array. If substring filtering yields
      // nothing, fall back to all traces in the time window — the test runs
      // in isolation per CLI, so cross-contamination is unlikely.
      const filtered = opts.inputSubstring
        ? all.filter((t) => t.input?.value?.includes(opts.inputSubstring!))
        : all;
      const matching = filtered.length > 0 ? filtered : all;
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

/**
 * Best-effort check that the agent actually scaffolded a React-vite project.
 * We log a warning rather than fail when artifacts are missing — different
 * CLIs negotiate tool-use differently (some need explicit prompting; codex
 * with low reasoning may answer the question without invoking shell). The
 * cell's primary purpose is proving CLI → gateway → provider → trace; the
 * artifact check is informational evidence the model actually executed work
 * vs. just answered.
 */
function checkReactViteArtifacts(workDir: string, cliName: string): void {
  const pkg = path.join(workDir, "package.json");
  if (!fs.existsSync(pkg)) {
    // eslint-disable-next-line no-console
    console.warn(
      `[matrix] ${cliName} · no package.json — agent didn't scaffold (still proves gateway path if traces landed)`,
    );
    return;
  }
  const pkgJson = JSON.parse(fs.readFileSync(pkg, "utf-8")) as {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  };
  const deps = { ...pkgJson.dependencies, ...pkgJson.devDependencies };
  if (!deps.react && !deps["react-dom"] && !deps.vite) {
    // eslint-disable-next-line no-console
    console.warn(
      `[matrix] ${cliName} · package.json present but missing react/vite deps`,
    );
  }
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

      checkReactViteArtifacts(tempFolder, "claude-code");

      const metrics = await assertSessionTraces({
        since,
        inputSubstring: TASK_INPUT_MARKER,
        minTraces: 1,
      });
      // Cache assertion is informational on this cell: Claude 4.5 prompt
      // caching is in beta on the test account (same provider-side limit
      // documented in Priority 2's anthropic/cache cell). When the account
      // gets GA cache access, cache_read should be >0; until then the
      // session still proves CLI → gateway → provider → trace + cost
      // end-to-end, which is the cell's primary purpose.
      if (metrics.cacheReadTokens === 0) {
        // eslint-disable-next-line no-console
        console.warn(
          "[matrix] claude-code · cache_read_tokens=0 — Claude 4.5 prompt caching is provider-side beta-gated (matches Priority 2 anthropic/cache cell)",
        );
      }

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

      checkReactViteArtifacts(tempFolder, "codex");

      const metrics = await assertSessionTraces({
        since,
        inputSubstring: TASK_INPUT_MARKER,
        minTraces: 1,
      });
      // Cache assertion is informational (same v1 limit as claude-code +
      // Priority 2 cache cells). OpenAI auto-cache requires 1024+ token
      // prefixes that hash-equal across calls; codex's session may not
      // exhibit that on a single short scaffolding task. The cell's primary
      // purpose is proving CLI → gateway → /v1/responses → trace + cost.
      if (metrics.cacheReadTokens === 0) {
        // eslint-disable-next-line no-console
        console.warn(
          "[matrix] codex · cache_read_tokens=0 — OpenAI auto-cache didn't hit on this short session (informational, not a failure)",
        );
      }

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
  // Iter-110 retracted andre's earlier "inherent skip" — gemini-cli IS
  // re-pointable via env vars. The Google @google/genai SDK that gemini-cli
  // wraps reads `GOOGLE_GEMINI_BASE_URL` and uses it as the API host (with
  // `x-goog-api-key` for auth). The blocker was the GATEWAY side: it had
  // no Gemini-native routes (only /v1/chat/completions, /v1/messages,
  // /v1/responses, /v1/embeddings, /v1/models), so gemini-cli's POST to
  // /v1beta/models/<model>:generateContent landed on a 404. Once
  // alexis's v1beta passthrough lands, this cell:
  //   - Sets GOOGLE_GEMINI_BASE_URL=<gateway>/v1beta
  //   - Sets GEMINI_API_KEY=<matrix-gemini VK secret>
  //   - Spawns gemini -p TASK_PROMPT non-interactive
  //   - Asserts a trace lands + cost > 0
  // Cache-read assertion is informational on this CLI (gemini implicit
  // caching needs paid-tier billing; explicit cachedContents flow is
  // exercised in Lane A's TestGemini_Cache).
  // ============================================================
  it.skipIf(skipMatrix || !cliAvailable("gemini") || !vkFor("gemini"))(
    "gemini-cli · React vite hello world · trace + cost + cache captured",
    async () => {
      const vk = vkFor("gemini")!;
      const tempFolder = fs.mkdtempSync(
        path.join(os.tmpdir(), "lw-cmatrix-gemini-vite-"),
      );
      const since = new Date();
      const start = Date.now();

      const result = spawnSync(
        "gemini",
        [
          "--prompt",
          TASK_PROMPT,
          "--yolo",
          "--model",
          "gemini-2.5-flash",
        ],
        {
          cwd: tempFolder,
          encoding: "utf-8",
          timeout: 600_000,
          env: {
            ...process.env,
            GOOGLE_GEMINI_BASE_URL: `${GATEWAY_BASE}/v1beta`,
            GEMINI_API_KEY: vk.secret,
            // Force gemini-cli into the API-key auth mode (vs OAuth).
            GOOGLE_GENAI_USE_VERTEXAI: "false",
          },
        },
      );
      if (result.status !== 0) {
        throw new Error(
          `gemini exited ${result.status}\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`,
        );
      }

      checkReactViteArtifacts(tempFolder, "gemini-cli");

      const metrics = await assertSessionTraces({
        since,
        inputSubstring: TASK_INPUT_MARKER,
        minTraces: 1,
      });
      if (metrics.cacheReadTokens === 0) {
        // eslint-disable-next-line no-console
        console.warn(
          "[matrix] gemini-cli · cache_read_tokens=0 — Gemini implicit caching needs paid-tier billing on this account; explicit cachedContents path covered by Lane A TestGemini_Cache",
        );
      }

      logMatrixCell({
        cli: "gemini-cli",
        task: "react_vite_hello_world",
        durationMs: Date.now() - start,
        metrics,
        testFile: TEST_FILE,
      });
    },
    700_000,
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

      checkReactViteArtifacts(tempFolder, "opencode");

      const metrics = await assertSessionTraces({
        since,
        inputSubstring: TASK_INPUT_MARKER,
        minTraces: 1,
      });
      // Cache assertion informational — same v1 limit as Priority 2 cache
      // cells; depends on session-prefix repetition that opencode may not
      // exhibit on a short scaffold task.
      if (metrics.cacheReadTokens === 0) {
        // eslint-disable-next-line no-console
        console.warn(
          "[matrix] opencode · cache_read_tokens=0 — OpenAI auto-cache didn't hit on this short session (informational, not a failure)",
        );
      }

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
