/**
 * @vitest-environment node
 *
 * Live SSE end-to-end through the actual Studio "Run" path:
 *   studioBackendPostEvent → invokeLambda(path: /go/studio/execute)
 *     → real nlpgo Go subprocess → real OpenAI provider call.
 *
 * Why this test exists:
 *   The interactive Studio "Run" button posts events to
 *   /api/workflows/post_event, which calls studioBackendPostEvent. That
 *   function used to ALWAYS route to the Python /studio/execute endpoint
 *   regardless of the FF — meaning the entire Go-engine migration was
 *   only exercised by the batch evaluation path (runWorkflow.ts). This
 *   test pins the FF-gated routing so a future refactor can't silently
 *   regress the live UI path.
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

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import type { StudioServerEvent } from "../../../../../optimization_studio/types/events";

// FF-on regardless of PostHog state.
vi.mock("../../../../../server/featureFlag/featureFlag.service", () => ({
  featureFlagService: {
    isEnabled: vi.fn().mockResolvedValue(true),
  },
}));

// No S3 dependency for the test — use undefined cache key.
vi.mock("../../../../../optimization_studio/server/addEnvs", async () => {
  const actual = await vi.importActual<
    typeof import("../../../../../optimization_studio/server/addEnvs")
  >("../../../../../optimization_studio/server/addEnvs");
  return {
    ...actual,
    getS3CacheKey: () => undefined,
  };
});

// Per-owner port scheme (rchaves's call): use the 5561X / 5562X range.
// Each port corresponds to a "real" production port + an extra trailing
// digit, so the connection between dev port and test port is obvious
// to readers and high enough to avoid collision with langwatch app on
// 5570, nlpgo on 5562, aigateway on 5563 even when the dev stack is
// running. Each live integration test that spawns its own nlpgo
// subprocess claims a unique port:
//   55620 — playground proxy live OpenAI (Ash)
//   55610 — this test (post_event SSE FF gating)
//   55611 — post_event evaluator with real provider e2e
const NLPGO_PORT = 55610;
const REPO_ROOT = path.resolve(__dirname, "../../../../../../..");

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

  // Point invokeLambda's URL-fallback branch (no LAMBDA_CONFIG) at our
  // local nlpgo subprocess. invokeLambda does:
  //   fetch(`${LANGWATCH_NLP_SERVICE}${path}`, ...)
  process.env.LANGWATCH_NLP_SERVICE = `http://127.0.0.1:${NLPGO_PORT}`;
  delete process.env.LANGWATCH_NLP_LAMBDA_CONFIG;

  nlpgoProcess = spawn("go", ["run", "./cmd/service", "nlpgo"], {
    cwd: REPO_ROOT,
    env: {
      ...process.env,
      NLPGO_CHILD_BYPASS: "true",
      // Override the Go service's default :5562 listener so we don't
      // collide with a dev nlpgo or aigateway already on PATH ports.
      SERVER_ADDR: `:${NLPGO_PORT}`,
    },
    stdio: ["ignore", "pipe", "pipe"],
    detached: false,
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
  if (!nlpgoProcess) return;
  nlpgoProcess.kill("SIGTERM");
  const exited = await Promise.race([
    new Promise<boolean>((resolve) =>
      nlpgoProcess!.once("exit", () => resolve(true)),
    ),
    sleep(2000).then(() => false),
  ]);
  if (!exited) nlpgoProcess.kill("SIGKILL");
});

const liveOpenAI = process.env.OPENAI_API_KEY ? it : it.skip;

describe("studioBackendPostEvent FF-gated SSE routing to nlpgo", () => {
  liveOpenAI(
    "execute_flow with FF on streams a real Studio workflow through /go/studio/execute and returns success",
    async () => {
      const { studioBackendPostEvent } = await import("../post-event");

      const workflow = {
        workflow_id: "ts-postevent-e2e",
        api_key: "k",
        spec_version: "1.3",
        name: "TS Post-Event E2E",
        icon: "🧪",
        description: "ts integration",
        version: "1.3",
        template_adapter: "default",
        nodes: [
          {
            id: "entry",
            type: "entry",
            data: {
              outputs: [{ identifier: "question", type: "str" }],
              dataset: {
                inline: {
                  records: { question: ["Reply with just the digit 7."] },
                },
              },
              entry_selection: 0,
              train_size: 1.0,
              test_size: 0.0,
              seed: 1,
            },
          },
          {
            id: "answer",
            type: "signature",
            data: {
              name: "Answer",
              parameters: [
                {
                  identifier: "llm",
                  type: "llm",
                  value: {
                    model: "openai/gpt-5-mini",
                    litellm_params: { api_key: process.env.OPENAI_API_KEY },
                  },
                },
              ],
              inputs: [{ identifier: "question", type: "str" }],
              outputs: [{ identifier: "answer", type: "str" }],
            },
          },
          {
            id: "end",
            type: "end",
            data: { inputs: [{ identifier: "answer", type: "str" }] },
          },
        ],
        edges: [
          {
            id: "e1",
            source: "entry",
            sourceHandle: "outputs.question",
            target: "answer",
            targetHandle: "inputs.question",
            type: "default",
          },
          {
            id: "e2",
            source: "answer",
            sourceHandle: "outputs.answer",
            target: "end",
            targetHandle: "inputs.answer",
            type: "default",
          },
        ],
        state: {},
      };

      const message = {
        type: "execute_flow" as const,
        payload: {
          trace_id: "ts-postevent-e2e-trace",
          workflow,
          inputs: [{}],
          origin: "workflow",
        },
      };

      const events: StudioServerEvent[] = [];
      await studioBackendPostEvent({
        projectId: "test-project",
        message: message as any,
        onEvent: (ev) => events.push(ev),
      });

      // SSE stream MUST terminate with a 'done' event for a successful
      // run. Anything else means we landed on an error path or the
      // legacy /studio/execute (which would 502 because nlpgo's child
      // proxy targets are bypassed).
      const done = events.find((e) => e.type === "done");
      const errorEvent = events.find((e) => e.type === "error");
      expect(
        errorEvent,
        errorEvent && "payload" in errorEvent
          ? JSON.stringify(errorEvent.payload)
          : "no error payload",
      ).toBeUndefined();
      expect(done, JSON.stringify(events.slice(-3))).toBeDefined();

      // The final state on the 'end' component carries the result. The
      // 'answer' field is whatever OpenAI replied with; it must contain
      // the digit we asked for. Loose match: the actual response often
      // includes trailing whitespace or punctuation.
      const componentChanges = events.filter(
        (e): e is Extract<StudioServerEvent, { type: "component_state_change" }> =>
          e.type === "component_state_change",
      );
      const lastEndChange = [...componentChanges]
        .reverse()
        .find((e) => e.payload.component_id === "end");
      expect(lastEndChange, JSON.stringify(events)).toBeDefined();
      const stringified = JSON.stringify(lastEndChange?.payload.execution_state);
      expect(stringified).toContain("7");
    },
    60_000,
  );
});
