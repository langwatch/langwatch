/**
 * Coding-agent gateway matrix.
 *
 * For each major coding CLI (claude-code, codex, gemini-cli, opencode) and a
 * representative set of scenarios (simple completion, long session with
 * caching, tool use), spawns the real CLI binary pointing at the LangWatch AI
 * Gateway via a freshly-minted virtual key, drives a coding task, and
 * verifies that the trace lands in LangWatch with non-zero token counts and a
 * captured cost.
 *
 * Cells skip when:
 *   - The CLI binary is not on PATH
 *   - The required env (LANGWATCH_API_KEY, LANGWATCH_GATEWAY_GPC_ID for the
 *     provider that backs the CLI) is missing
 *   - CI=1 (these tests cost real money against real providers)
 *
 * On success, each cell prints a single matrix line:
 *   [matrix] cli=claude-code scenario=simple_task duration=12.4s cost=$0.000412
 *
 * The values are aggregated into .claude/AI-GATEWAY-TEST-MATRIX.md by the
 * post-run reporter (a follow-up; today's runner just prints to stdout).
 */
import { spawnSync, type SpawnSyncReturns } from "child_process";
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

// Provider GPC ids — the matrix needs one bound provider credential per
// provider family the CLI calls. Set these in skills/_tests/.env or env.
// LANGWATCH_GATEWAY_GPC_OPENAI, LANGWATCH_GATEWAY_GPC_ANTHROPIC, ...
const GPC = {
  openai: process.env.LANGWATCH_GATEWAY_GPC_OPENAI,
  anthropic: process.env.LANGWATCH_GATEWAY_GPC_ANTHROPIC,
  gemini: process.env.LANGWATCH_GATEWAY_GPC_GEMINI,
} as const;

interface MintedVK {
  id: string;
  secret: string;
}

/**
 * Mint a fresh VK against the named provider via the langwatch CLI built in
 * typescript-sdk/dist. The local CLI wrapper at skills/_tests/helpers
 * (setupLocalCli) is the same one used by the existing scenario tests.
 *
 * Throws (and the surrounding test fails) if LANGWATCH_API_KEY or the GPC id
 * for the provider is missing — caller should pre-flight via cliAvailable().
 */
function mintVK(opts: {
  provider: keyof typeof GPC;
  workingDir: string;
}): MintedVK {
  const gpc = GPC[opts.provider];
  if (!gpc) {
    throw new Error(
      `Missing LANGWATCH_GATEWAY_GPC_${opts.provider.toUpperCase()} env`,
    );
  }
  const cliPath = path.resolve(
    __dirname,
    "../../typescript-sdk/dist/cli/index.js",
  );
  if (!fs.existsSync(cliPath)) {
    throw new Error(
      `langwatch CLI not built at ${cliPath} — run 'pnpm build' in typescript-sdk/`,
    );
  }
  const name = `coding-agent-matrix-${opts.provider}-${Date.now()}`;
  const result: SpawnSyncReturns<string> = spawnSync(
    "node",
    [
      cliPath,
      "virtual-keys",
      "create",
      "--name",
      name,
      "--description",
      "auto-minted by coding-agent matrix test",
      "--environment",
      "test",
      "--provider",
      gpc,
      "--format",
      "json",
    ],
    {
      cwd: opts.workingDir,
      encoding: "utf-8",
      env: { ...process.env, LANGWATCH_API_KEY: process.env.LANGWATCH_API_KEY },
    },
  );
  if (result.status !== 0) {
    throw new Error(
      `langwatch virtual-keys create failed (status ${result.status}): ${result.stderr}`,
    );
  }
  const parsed = JSON.parse(result.stdout) as { id: string; secret: string };
  if (!parsed.id || !parsed.secret) {
    throw new Error(
      `langwatch virtual-keys create returned unexpected JSON: ${result.stdout}`,
    );
  }
  return { id: parsed.id, secret: parsed.secret };
}

/**
 * Returns true if the named CLI is on PATH and runnable.
 */
function cliAvailable(cli: string): boolean {
  const probe = spawnSync(cli, ["--version"], {
    encoding: "utf-8",
    stdio: ["ignore", "ignore", "ignore"],
  });
  return probe.status === 0;
}

/**
 * Polls the LangWatch traces API for a trace tagged with the given
 * virtualKeyId. Returns the first matching trace's (cost, inputTokens,
 * outputTokens). Times out after `timeoutMs` ms.
 */
async function assertTraceLanded(opts: {
  virtualKeyId: string;
  since: Date;
  timeoutMs?: number;
}): Promise<{ costUsd: number; inputTokens: number; outputTokens: number }> {
  const apiKey = process.env.LANGWATCH_API_KEY;
  if (!apiKey) throw new Error("LANGWATCH_API_KEY is required");
  const timeout = opts.timeoutMs ?? 30_000;
  const deadline = Date.now() + timeout;

  while (Date.now() < deadline) {
    const url =
      `${LW_BASE}/api/traces/search?` +
      new URLSearchParams({
        startedAt: opts.since.toISOString(),
        // The trace search filter shape may evolve — caller should adapt.
        // For the v1 scaffold, we filter by VK id at the
        // langwatch.virtual_key_id span attribute level.
        "filter[langwatch.virtual_key_id]": opts.virtualKeyId,
      });
    const res = await fetch(url, {
      headers: { "X-Auth-Token": apiKey },
    });
    if (res.ok) {
      const body = (await res.json()) as {
        traces?: Array<{
          metrics?: {
            total_cost?: number;
            prompt_tokens?: number;
            completion_tokens?: number;
          };
        }>;
      };
      const t = body.traces?.[0];
      const cost = t?.metrics?.total_cost ?? 0;
      const input = t?.metrics?.prompt_tokens ?? 0;
      const output = t?.metrics?.completion_tokens ?? 0;
      if (cost > 0 && input > 0 && output > 0) {
        return {
          costUsd: cost,
          inputTokens: input,
          outputTokens: output,
        };
      }
    }
    await new Promise((r) => setTimeout(r, 1_500));
  }
  throw new Error(
    `No trace with cost > 0 landed for VK ${opts.virtualKeyId} within ${timeout}ms`,
  );
}

/**
 * Logs a single matrix-table line — picked up by the post-run reporter that
 * appends to .claude/AI-GATEWAY-TEST-MATRIX.md.
 */
function logMatrixCell(opts: {
  cli: string;
  scenario: string;
  durationMs: number;
  costUsd: number;
  testFile: string;
}): void {
  // eslint-disable-next-line no-console
  console.log(
    `[matrix] cli=${opts.cli} scenario=${opts.scenario} ` +
      `duration=${(opts.durationMs / 1000).toFixed(1)}s ` +
      `cost=$${opts.costUsd.toFixed(6)} ` +
      `file=${opts.testFile}`,
  );
}

const skipMatrix = isCI || !process.env.LANGWATCH_API_KEY;

describe("AI Gateway — coding-agent matrix", () => {
  describe("claude-code", () => {
    const cli = "claude";
    const skipCli = skipMatrix || !cliAvailable(cli) || !GPC.anthropic;

    it.skipIf(skipCli)(
      "claude-code · simple completion · trace + cost captured",
      async () => {
        const start = Date.now();
        const tempFolder = fs.mkdtempSync(
          path.join(os.tmpdir(), "lw-cmatrix-claude-simple-"),
        );
        const vk = mintVK({ provider: "anthropic", workingDir: tempFolder });
        const since = new Date();

        const result = spawnSync(
          cli,
          ["--print", "Write a one-line python hello world. Reply only with code."],
          {
            cwd: tempFolder,
            encoding: "utf-8",
            timeout: 60_000,
            env: {
              ...process.env,
              ANTHROPIC_BASE_URL: GATEWAY_BASE,
              ANTHROPIC_AUTH_TOKEN: vk.secret,
              // Strip the user's own ANTHROPIC_API_KEY so the gateway VK is the
              // only credential the CLI sees.
              ANTHROPIC_API_KEY: "",
            },
          },
        );
        expect(result.status).toBe(0);

        const trace = await assertTraceLanded({
          virtualKeyId: vk.id,
          since,
        });
        expect(trace.inputTokens).toBeGreaterThan(0);
        expect(trace.outputTokens).toBeGreaterThan(0);
        expect(trace.costUsd).toBeGreaterThan(0);

        logMatrixCell({
          cli: "claude-code",
          scenario: "simple_task",
          durationMs: Date.now() - start,
          costUsd: trace.costUsd,
          testFile: "skills/_tests/cli-gateway-coding-agents.scenario.test.ts",
        });
      },
      120_000,
    );

    it.skipIf(skipCli)(
      "claude-code · long session with caching · trace + cost captured",
      async () => {
        // TODO: drive a multi-turn session that triggers Anthropic prompt
        // caching. Assert cache_read_input_tokens > 0 on the trace's
        // gen_ai.usage.* attributes.
        expect.fail("not yet implemented — long-session-with-caching cell");
      },
      300_000,
    );

    it.skipIf(skipCli)(
      "claude-code · tool use · trace + cost captured",
      async () => {
        // TODO: drive a task that requires the model to call a tool (e.g.
        // "list the files in this directory and summarise them" — claude
        // will use the Read tool). Assert tool-call deltas appear in the
        // trace and cost > 0.
        expect.fail("not yet implemented — tool-use cell");
      },
      300_000,
    );
  });

  describe("codex", () => {
    const cli = "codex";
    const skipCli = skipMatrix || !cliAvailable(cli) || !GPC.openai;

    it.skipIf(skipCli)(
      "codex · simple completion · trace + cost captured",
      async () => {
        // TODO: spawn `codex exec "..."` with OPENAI_BASE_URL pointing at
        // gateway + OPENAI_API_KEY=<vk_secret>. Mirror the claude-code
        // simple cell shape.
        expect.fail("not yet implemented — codex simple_task cell");
      },
      120_000,
    );

    it.skipIf(skipCli)(
      "codex · long session with caching · trace + cost captured",
      async () => {
        expect.fail("not yet implemented — codex long-session cell");
      },
      300_000,
    );

    it.skipIf(skipCli)(
      "codex · tool use · trace + cost captured",
      async () => {
        expect.fail("not yet implemented — codex tool-use cell");
      },
      300_000,
    );
  });

  describe("gemini-cli", () => {
    const cli = "gemini";
    const skipCli = skipMatrix || !cliAvailable(cli) || !GPC.gemini;

    it.skipIf(skipCli)(
      "gemini-cli · simple completion · trace + cost captured",
      async () => {
        // TODO: gemini-cli supports a custom --endpoint flag and
        // GEMINI_API_KEY env. Map onto the gateway via that path.
        expect.fail("not yet implemented — gemini-cli simple_task cell");
      },
      120_000,
    );

    it.skipIf(skipCli)(
      "gemini-cli · long session with caching · trace + cost captured",
      async () => {
        expect.fail("not yet implemented — gemini-cli long-session cell");
      },
      300_000,
    );

    it.skipIf(skipCli)(
      "gemini-cli · tool use · trace + cost captured",
      async () => {
        expect.fail("not yet implemented — gemini-cli tool-use cell");
      },
      300_000,
    );
  });

  describe("opencode", () => {
    const cli = "opencode";
    // opencode supports multi-provider config — default to OpenAI for v1
    const skipCli = skipMatrix || !cliAvailable(cli) || !GPC.openai;

    it.skipIf(skipCli)(
      "opencode · simple completion · trace + cost captured",
      async () => {
        // TODO: opencode reads ~/.opencode/config.json — write a config
        // pointing at the gateway with the minted VK, then spawn
        // `opencode --headless ...`.
        expect.fail("not yet implemented — opencode simple_task cell");
      },
      120_000,
    );

    it.skipIf(skipCli)(
      "opencode · long session with caching · trace + cost captured",
      async () => {
        expect.fail("not yet implemented — opencode long-session cell");
      },
      300_000,
    );

    it.skipIf(skipCli)(
      "opencode · tool use · trace + cost captured",
      async () => {
        expect.fail("not yet implemented — opencode tool-use cell");
      },
      300_000,
    );
  });
});
