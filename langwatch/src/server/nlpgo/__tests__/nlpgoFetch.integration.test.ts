/**
 * @vitest-environment node
 *
 * End-to-end TS integration: spins up a real `nlpgo` Go subprocess,
 * mocks the feature flag to ON, and exercises the same `nlpgoFetch`
 * helper that `runWorkflow.ts` calls in production. The signature
 * node hits a live OpenAI endpoint via the in-process dispatcher.
 *
 * Why this test exists:
 *   - rchaves's QA matrix asks for proof that the actual app surface
 *     works end-to-end, not unit tests of individual components.
 *   - Browser dogfood is one form of evidence; this is the
 *     repeatable-on-CI variant. Stays green forever (or alerts) if
 *     any link in the chain breaks: TS app routing, nlpgoFetch
 *     envelope, nlpgo handler, engine, dispatcher, Bifrost,
 *     provider integration.
 *
 * Skipped (not failed) when:
 *   - OPENAI_API_KEY not set
 *   - go binary not on PATH
 *
 * Each run takes ~2-4s for the dispatch + LLM call; subprocess startup
 * adds ~3s on first invocation due to `go run` compilation.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import path from "node:path";

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// Mock the feature flag service BEFORE importing the helper so the
// FF check returns true regardless of PostHog state.
vi.mock("../../featureFlag/featureFlag.service", () => ({
  featureFlagService: {
    isEnabled: vi.fn().mockResolvedValue(true),
  },
}));

// Mock lambdaFetch so it routes through plain fetch instead of trying
// to invoke an AWS Lambda. The Go subprocess is reachable on
// http://127.0.0.1:5562 so we use that as the "function arn"
// (lambdaFetch's URL fallback is a string base URL).
vi.mock("../../../utils/lambdaFetch", () => ({
  lambdaFetch: async (
    baseURL: string,
    pathSuffix: string,
    init: { method: string; headers: Record<string, string>; body: string },
  ) => {
    const resp = await fetch(baseURL + pathSuffix, init);
    return {
      ok: resp.ok,
      status: resp.status,
      statusText: resp.statusText,
      json: () => resp.json(),
      text: () => resp.text(),
    };
  },
}));

// Mock getProjectLambdaArn to return our local nlpgo URL.
vi.mock("../../../optimization_studio/server/lambda", () => ({
  getProjectLambdaArn: async () => "http://127.0.0.1:5562",
}));

const NLPGO_PORT = 5562;
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
  if (!process.env.OPENAI_API_KEY) return; // test will be skipped at the it() level
  // Spawn `go run ./cmd/service nlpgo` from the repo root, with
  // NLPGO_CHILD_BYPASS=true so it doesn't try to spawn uvicorn (no
  // langwatch_nlp Python venv in test env).
  nlpgoProcess = spawn("go", ["run", "./cmd/service", "nlpgo"], {
    cwd: REPO_ROOT,
    env: {
      ...process.env,
      NLPGO_CHILD_BYPASS: "true",
    },
    stdio: ["ignore", "pipe", "pipe"],
    detached: false,
  });

  // Surface stderr to the test logs for debugging — stdout is just
  // structured logs.
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
  // SIGTERM, then SIGKILL after 2s if still running.
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

describe("nlpgoFetch end-to-end against live nlpgo subprocess", () => {
  liveOpenAI("routes a Studio workflow to /go/studio/execute_sync and returns a real LLM result", async () => {
    const { nlpgoFetch } = await import("../nlpgoFetch");

    const workflow = {
      workflow_id: "ts-e2e",
      api_key: "k",
      spec_version: "1.3",
      name: "TS E2E",
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
                records: { question: ["Reply with just the digit 4."] },
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

    const event = {
      type: "execute_flow",
      payload: {
        trace_id: "ts-e2e-trace",
        workflow,
        inputs: [{}],
        origin: "workflow",
      },
    };

    const res = await nlpgoFetch({
      projectId: "test-project",
      path: "/studio/execute_sync",
      body: event,
      origin: "workflow",
    });

    expect(res.ok).toBe(true);
    expect(res.enginePath).toBe("go");

    const body = (await res.json()) as {
      status: string;
      result?: { answer?: string };
      error?: { message?: string };
    };
    expect(body.status, JSON.stringify(body.error)).toBe("success");
    expect(body.result?.answer).toBeDefined();
    expect(body.result?.answer).toContain("4");
  }, 60_000);
});
