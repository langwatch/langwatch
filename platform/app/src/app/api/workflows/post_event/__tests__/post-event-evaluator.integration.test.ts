/**
 * @vitest-environment node
 *
 * Mandatory evaluator-with-real-provider e2e through Studio's
 * `studioBackendPostEvent` SSE surface. Per owner: this is the
 * headline test the migration must produce — proves cost / score /
 * passed / details propagate from a Go-engine evaluator node all the
 * way back through the Studio SSE stream that the TS reducer consumes.
 *
 * Topology:
 *
 *   Studio post_event (TS app)
 *     └─ studioBackendPostEvent FF-routed
 *        └─ POST /go/studio/execute (nlpgo subprocess)
 *           ├─ entry → real-OpenAI signature → fake-LangWatch evaluator → end
 *           └─ engine.runEvaluator hits ${LANGWATCH_BASE_URL}/api/evaluations/<slug>/evaluate
 *              └─ canned response: {status, score, passed, details, cost}
 *
 * Skipped (not failed) when:
 *   - OPENAI_API_KEY not set (signature node needs it)
 *   - go binary not on PATH
 *
 * Run cost: ~5-8s + ~3s subprocess startup.
 */
import { spawn, type ChildProcess } from "node:child_process";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { setTimeout as sleep } from "node:timers/promises";
import path from "node:path";

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import type { StudioServerEvent } from "../../../../../optimization_studio/types/events";

vi.mock("../../../../../server/featureFlag/featureFlag.service", () => ({
  featureFlagService: {
    isEnabled: vi.fn().mockResolvedValue(true),
  },
}));

vi.mock("../../../../../optimization_studio/server/addEnvs", async () => {
  const actual = await vi.importActual<
    typeof import("../../../../../optimization_studio/server/addEnvs")
  >("../../../../../optimization_studio/server/addEnvs");
  return {
    ...actual,
    getS3CacheKey: () => undefined,
  };
});

// Per-owner port scheme: 5561X / 5562X range (production port + extra
// trailing digit, makes the dev↔test connection obvious to readers).
// Each live integration test that spawns its own nlpgo subprocess
// claims a unique port:
//   55620 — playground proxy live OpenAI
//   55610 — post_event SSE FF gating
//   55611 — this test (post_event evaluator with real provider e2e)
const NLPGO_PORT = 55611;
const REPO_ROOT = path.resolve(__dirname, "../../../../../../..");

let nlpgoProcess: ChildProcess | null = null;
let langwatchSrv: http.Server | null = null;
let langwatchURL = "";

interface CapturedEvalCall {
  path: string;
  method: string;
  authToken: string;
  traceId: string;
  origin: string;
  body: Record<string, unknown>;
}
const capturedEvalCalls: CapturedEvalCall[] = [];

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

  // Spin up a fake LangWatch evaluator endpoint that records every
  // request and returns a canned processed result.
  langwatchSrv = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf-8");
      let parsed: Record<string, unknown> = {};
      try {
        parsed = JSON.parse(raw) as Record<string, unknown>;
      } catch {
        // leave parsed empty
      }
      capturedEvalCalls.push({
        path: req.url ?? "",
        method: req.method ?? "",
        authToken: (req.headers["x-auth-token"] as string) ?? "",
        traceId: (req.headers["x-langwatch-trace-id"] as string) ?? "",
        origin: (req.headers["x-langwatch-origin"] as string) ?? "",
        body: parsed,
      });
      res.setHeader("Content-Type", "application/json");
      res.end(
        JSON.stringify({
          status: "processed",
          score: 0.91,
          passed: true,
          details: "fake evaluator: looks good",
          cost: { currency: "USD", amount: 0.000123 },
        }),
      );
    });
  });
  await new Promise<void>((resolve) =>
    langwatchSrv!.listen(0, "127.0.0.1", () => resolve()),
  );
  const addr = langwatchSrv.address() as AddressInfo;
  langwatchURL = `http://127.0.0.1:${addr.port}`;

  process.env.LANGWATCH_NLP_SERVICE = `http://127.0.0.1:${NLPGO_PORT}`;
  delete process.env.LANGWATCH_NLP_LAMBDA_CONFIG;

  // detached:true so afterAll's process.kill(-pid) reaches the
  // compiled child of `go run`, not just the toolchain wrapper.
  // See post-event.integration.test.ts for the full rationale.
  nlpgoProcess = spawn("go", ["run", "./cmd/service", "nlpgo"], {
    cwd: REPO_ROOT,
    env: {
      ...process.env,
      NLPGO_CHILD_BYPASS: "true",
      SERVER_ADDR: `:${NLPGO_PORT}`,
      NLPGO_ENGINE_LANGWATCH_BASE_URL: langwatchURL,
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
  if (nlpgoProcess?.pid) {
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
  }
  if (langwatchSrv) {
    await new Promise<void>((resolve) => langwatchSrv!.close(() => resolve()));
  }
});

const liveOpenAI = process.env.OPENAI_API_KEY ? it : it.skip;

describe("Studio post_event SSE: signature → evaluator e2e (real OpenAI + fake LangWatch)", () => {
  liveOpenAI(
    "evaluator's score / passed / details / cost propagate through the SSE stream end-to-end",
    async () => {
      capturedEvalCalls.length = 0;

      const { studioBackendPostEvent } = await import("../post-event");

      // entry → signature(real OpenAI) → evaluator(fake LangWatch) → end
      const workflow = {
        workflow_id: "ts-eval-e2e",
        api_key: "sk-test-project-abc",
        spec_version: "1.3",
        name: "Eval E2E",
        icon: "🧪",
        description: "evaluator e2e",
        version: "1.3",
        template_adapter: "default",
        nodes: [
          {
            id: "entry",
            type: "entry",
            data: {
              outputs: [
                { identifier: "question", type: "str" },
                { identifier: "expected_output", type: "str" },
              ],
              dataset: {
                inline: {
                  records: {
                    question: ["Reply with just the digit 9."],
                    expected_output: ["9"],
                  },
                  count: 1,
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
            id: "eval",
            type: "evaluator",
            data: {
              parameters: [
                {
                  identifier: "evaluator",
                  type: "str",
                  value: "langevals/exact_match",
                },
                { identifier: "name", type: "str", value: "strict-match" },
                {
                  identifier: "settings",
                  type: "dict",
                  value: { mode: "exact" },
                },
              ],
              outputs: [
                { identifier: "score", type: "float" },
                { identifier: "passed", type: "bool" },
                { identifier: "details", type: "str" },
                { identifier: "cost", type: "dict" },
              ],
            },
          },
          {
            id: "end",
            type: "end",
            data: {
              inputs: [
                { identifier: "score", type: "float" },
                { identifier: "passed", type: "bool" },
                { identifier: "details", type: "str" },
                { identifier: "cost", type: "dict" },
              ],
            },
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
            target: "eval",
            targetHandle: "output",
            type: "default",
          },
          {
            id: "e3",
            source: "entry",
            sourceHandle: "outputs.expected_output",
            target: "eval",
            targetHandle: "expected_output",
            type: "default",
          },
          {
            id: "e4",
            source: "entry",
            sourceHandle: "outputs.question",
            target: "eval",
            targetHandle: "input",
            type: "default",
          },
          {
            id: "e5",
            source: "eval",
            sourceHandle: "score",
            target: "end",
            targetHandle: "score",
            type: "default",
          },
          {
            id: "e6",
            source: "eval",
            sourceHandle: "passed",
            target: "end",
            targetHandle: "passed",
            type: "default",
          },
          {
            id: "e7",
            source: "eval",
            sourceHandle: "details",
            target: "end",
            targetHandle: "details",
            type: "default",
          },
          {
            id: "e8",
            source: "eval",
            sourceHandle: "cost",
            target: "end",
            targetHandle: "cost",
            type: "default",
          },
        ],
        state: {},
      };

      const message = {
        type: "execute_flow" as const,
        payload: {
          trace_id: "ts-eval-e2e-trace",
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

      // Stream must terminate cleanly.
      const errorEvent = events.find((e) => e.type === "error");
      expect(
        errorEvent,
        errorEvent && "payload" in errorEvent
          ? JSON.stringify(errorEvent.payload)
          : "no error",
      ).toBeUndefined();
      expect(events.find((e) => e.type === "done")).toBeDefined();

      // Evaluator node must surface a final state-change carrying the
      // canned score / passed / details / cost. Cost is the tricky one
      // owner explicitly called out as load-bearing — engine projects
      // upstream's {currency, amount} dict onto the per-node outputs
      // when the workflow declares `cost` as an output, AND surfaces
      // the amount on `execution_state.cost` for the workflow-level
      // total accumulator.
      const componentChanges = events.filter(
        (e): e is Extract<StudioServerEvent, { type: "component_state_change" }> =>
          e.type === "component_state_change",
      );
      const finalEvalChange = [...componentChanges]
        .reverse()
        .find(
          (e) =>
            e.payload.component_id === "eval" &&
            (e.payload.execution_state as any)?.status === "success",
        );
      expect(
        finalEvalChange,
        `expected a final success component_state_change for 'eval'; events=${JSON.stringify(componentChanges)}`,
      ).toBeDefined();
      const evalOutputs = (finalEvalChange?.payload.execution_state as any)
        ?.outputs;
      expect(evalOutputs).toBeDefined();
      expect(evalOutputs.score).toBeCloseTo(0.91, 5);
      expect(evalOutputs.passed).toBe(true);
      expect(evalOutputs.details).toContain("looks good");
      expect(evalOutputs.cost).toEqual({ currency: "USD", amount: 0.000123 });
      // The workflow-level cost field on execution_state surfaces the
      // numeric amount so trace + billing aggregators don't have to
      // unpack the {currency, amount} dict.
      expect(
        (finalEvalChange?.payload.execution_state as any)?.cost,
      ).toBeCloseTo(0.000123, 9);

      // End node must produce the same score/passed/details/cost as
      // outputs (proves the edge wiring of all four evaluator → end
      // edges works end-to-end).
      const finalEndChange = [...componentChanges]
        .reverse()
        .find((e) => e.payload.component_id === "end");
      expect(finalEndChange).toBeDefined();
      const endOutputs = (finalEndChange?.payload.execution_state as any)
        ?.outputs;
      expect(endOutputs.score).toBeCloseTo(0.91, 5);
      expect(endOutputs.passed).toBe(true);
      expect(endOutputs.cost).toEqual({ currency: "USD", amount: 0.000123 });

      // Wire validation: exactly one evaluator HTTP call landed at the
      // fake LangWatch with the right URL, project apiKey on
      // X-Auth-Token, trace_id propagated, and body carrying name +
      // settings + data.
      expect(capturedEvalCalls).toHaveLength(1);
      const call = capturedEvalCalls[0]!;
      expect(call.method).toBe("POST");
      expect(call.path).toBe("/api/evaluations/langevals/exact_match/evaluate");
      expect(call.authToken).toBe("sk-test-project-abc");
      expect(call.traceId).toBe("ts-eval-e2e-trace");
      expect(call.origin).toBe("workflow");
      expect(call.body.name).toBe("strict-match");
      expect((call.body.settings as Record<string, unknown>).mode).toBe(
        "exact",
      );
      const data = call.body.data as Record<string, unknown>;
      expect(data.expected_output).toBe("9");
      // The signature's answer ought to mention the digit 9.
      expect(String(data.output)).toContain("9");
    },
    90_000,
  );
});
