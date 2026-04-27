/**
 * @vitest-environment node
 *
 * Live OpenAI-shape chat completion through the new
 * /go/proxy/v1/chat/completions endpoint. Spawns nlpgo as a subprocess,
 * POSTs an OpenAI-style request with x-litellm-* credential headers
 * (the same shape playground.ts + getVercelAIModel build today), asserts
 * the upstream response decodes as a real OpenAI completion with
 * non-empty assistant content.
 *
 * Why this test exists:
 *   The playground proxy chain landed in three commits across iter 18+:
 *     1. 3570dc12c — gatewayproxy/headers.go (header → Credential map)
 *     2. 89dd7e4b9 — handler + dispatcher wiring
 *     3. 6564c7dfc — TS callsite flag-gating
 *   Without an end-to-end test, a regression in any of those layers
 *   wouldn't surface until customer playground traffic hit it. This
 *   test pins the whole chain at the wire level — same shape the TS
 *   app actually sends (x-litellm-* headers, OpenAI body).
 *
 * Skipped (not failed) when:
 *   - OPENAI_API_KEY not set
 *   - go binary not on PATH
 *
 * Run cost: ~3-5s per invocation + ~3s subprocess startup.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import path from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

// Port choice: 55620 (one extra zero on the standard nlpgo :5562) so the
// test doesn't collide with any worktree running langwatch on PORT=5570
// (which would put aigateway on :5573 by the +N*10 convention). High
// enough not to clash with any normal dev server or another test slot.
const NLPGO_PORT = 55620;
const REPO_ROOT = path.resolve(__dirname, "../../../../../..");

let nlpgoProcess: ChildProcess | null = null;

async function waitForHealth(timeoutMs = 30_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const r = await fetch(`http://127.0.0.1:${NLPGO_PORT}/healthz`);
      if (r.status === 200 || r.status === 503) return;
    } catch {
      // not ready yet
    }
    await sleep(250);
  }
  throw new Error(`nlpgo did not become healthy within ${timeoutMs}ms`);
}

beforeAll(async () => {
  if (!process.env.OPENAI_API_KEY) return;

  // detached:true so afterAll's process.kill(-pid) reaches the
  // compiled child of `go run`, not just the toolchain wrapper.
  // See post-event.integration.test.ts for the full rationale.
  nlpgoProcess = spawn("go", ["run", "./cmd/service", "nlpgo"], {
    cwd: REPO_ROOT,
    env: {
      ...process.env,
      NLPGO_CHILD_BYPASS: "true",
      SERVER_ADDR: `:${NLPGO_PORT}`,
    },
    stdio: ["ignore", "pipe", "pipe"],
    detached: true,
  });

  nlpgoProcess.stderr?.on("data", (chunk: Buffer) => {
    if (process.env.NLPGO_TEST_LOG === "1") {
      process.stderr.write(`[nlpgo] ${chunk.toString()}`);
    }
  });
  nlpgoProcess.on("exit", (code, signal) => {
    if (code !== 0 && code !== null) {
      console.error(`nlpgo exited unexpectedly: code=${code} signal=${signal}`);
    }
  });

  await waitForHealth();
}, 90_000);

afterAll(async () => {
  if (!nlpgoProcess?.pid) return;
  const pgid = -nlpgoProcess.pid;
  try {
    process.kill(pgid, "SIGTERM");
  } catch {
    // group already gone
  }
  const exited = await Promise.race([
    new Promise<boolean>((resolve) =>
      nlpgoProcess!.once("exit", () => resolve(true)),
    ),
    sleep(2000).then(() => false),
  ]);
  if (!exited) {
    try {
      process.kill(pgid, "SIGKILL");
    } catch {
      // best-effort
    }
  }
});

const liveOpenAI = process.env.OPENAI_API_KEY ? it : it.skip;

describe("playground proxy /go/proxy/v1/chat/completions", () => {
  liveOpenAI(
    "non-streaming OpenAI chat completion routes through nlpgo and returns assistant content",
    async () => {
      const url = `http://127.0.0.1:${NLPGO_PORT}/go/proxy/v1/chat/completions`;
      const body = {
        model: "openai/gpt-5-mini",
        messages: [
          {
            role: "user" as const,
            content: "Reply with the single digit '4' and nothing else.",
          },
        ],
        temperature: 0,
        max_tokens: 16,
      };
      const resp = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-litellm-model": "openai/gpt-5-mini",
          "x-litellm-api_key": process.env.OPENAI_API_KEY!,
        },
        body: JSON.stringify(body),
      });

      expect(resp.status).toBe(200);
      const json = (await resp.json()) as {
        id?: string;
        choices?: Array<{
          message?: { role?: string; content?: string };
        }>;
        usage?: { total_tokens?: number };
      };

      // OpenAI completion shape — id, choices array, message with content.
      expect(typeof json.id).toBe("string");
      expect(Array.isArray(json.choices)).toBe(true);
      expect(json.choices?.length ?? 0).toBeGreaterThan(0);
      const content = json.choices?.[0]?.message?.content ?? "";
      expect(content.length).toBeGreaterThan(0);
      // Loose containment so model variations don't flake the test.
      expect(content).toContain("4");
    },
    30_000,
  );

  liveOpenAI(
    "streaming OpenAI chat completion delivers SSE deltas terminated by [DONE]",
    async () => {
      const url = `http://127.0.0.1:${NLPGO_PORT}/go/proxy/v1/chat/completions`;
      const body = {
        model: "openai/gpt-5-mini",
        messages: [
          { role: "user" as const, content: "Say 'hi' in one word." },
        ],
        temperature: 0,
        max_tokens: 8,
        stream: true,
      };
      const resp = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-litellm-model": "openai/gpt-5-mini",
          "x-litellm-api_key": process.env.OPENAI_API_KEY!,
        },
        body: JSON.stringify(body),
      });

      expect(resp.status).toBe(200);
      const ct = resp.headers.get("content-type") ?? "";
      expect(ct).toContain("text/event-stream");

      // Drain the SSE stream and collect data: frames.
      const reader = resp.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      const dataFrames: string[] = [];
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          if (line.startsWith("data: ")) {
            dataFrames.push(line.slice(6).trim());
          }
        }
      }

      expect(dataFrames.length).toBeGreaterThan(1);
      // The OpenAI streaming protocol terminates with a literal [DONE]
      // sentinel; the playground reducer relies on it to close the bubble.
      expect(dataFrames[dataFrames.length - 1]).toBe("[DONE]");
      // Some frames must carry actual delta content (not all blank).
      const hasContent = dataFrames.some((f) => {
        if (f === "[DONE]") return false;
        try {
          const parsed = JSON.parse(f) as {
            choices?: Array<{ delta?: { content?: string } }>;
          };
          return Boolean(parsed.choices?.[0]?.delta?.content);
        } catch {
          return false;
        }
      });
      expect(hasContent).toBe(true);
    },
    30_000,
  );

  liveOpenAI(
    "missing provider header returns 400 without touching upstream",
    async () => {
      const url = `http://127.0.0.1:${NLPGO_PORT}/go/proxy/v1/chat/completions`;
      const resp = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // No x-litellm-* headers and no provider prefix in body.model.
        body: JSON.stringify({
          model: "gpt-5-mini",
          messages: [{ role: "user", content: "hi" }],
        }),
      });
      expect(resp.status).toBe(400);
    },
    10_000,
  );
});
