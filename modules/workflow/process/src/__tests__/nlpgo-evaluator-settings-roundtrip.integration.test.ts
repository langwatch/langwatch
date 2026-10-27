/**
 * The dispatch hop for an evaluator configured on the Studio canvas.
 * Each end was separately tested, so neither test could see that they
 * disagreed on the wire shape and dropped every inline setting.
 */
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

import { hasGo, type NlpgoSubprocess, startNlpgoSubprocess } from "@langwatch/test-harness/nlpgo";
import {
  mergeLocalConfigsIntoDsl,
  type Component,
  type Field,
  type StudioNode,
} from "@langwatch/workflow-contract";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

// Unique port alongside the other nlpgo subprocess integration tests
// (55610 / 55611 / 55612 / 55613 / 55614 / 55615 / 55620). 55616 is this one's.
const NLPGO_PORT = 55616;

const PROJECT_ID = "project_evaluator_settings";
const TRACE_ID = "evalset0123456789evalset01234567";

/** A saved evaluator the panel edits without saving, and a bare slug. */
const SAVED_EVALUATOR_REF = "evaluators/eval_inline_settings";
const INLINE_EVALUATOR_SLUG = "langevals/llm_boolean";

/** What the properties panel wrote onto the node, none of it saved. */
const CANVAS_SETTINGS = {
  model: "openai/gpt-5-mini",
  max_tokens: 256,
  prompt: "Is the output a yes?",
};

/** The evaluate call the engine made, as the app would have received it. */
interface CapturedEvaluation {
  path: string;
  body: { name?: string; settings?: Record<string, unknown>; data?: Record<string, unknown> };
}

/**
 * The LangWatch app's evaluator endpoint, faked. Its real handler merges
 * defaults, then the saved evaluator, then the request body, so the settings
 * it receives are the top precedence layer: the body is the outcome.
 */
class FakeEvaluatorApi {
  calls: CapturedEvaluation[] = [];
  private server: Server | undefined;
  private origin = "";

  async start(): Promise<string> {
    const server = createServer((request, response) => {
      const chunks: Buffer[] = [];
      request.on("data", (chunk: Buffer) => chunks.push(chunk));
      request.on("end", () => {
        this.calls.push({
          path: request.url ?? "",
          body: JSON.parse(Buffer.concat(chunks).toString("utf-8")),
        });
        response
          .writeHead(200, { "Content-Type": "application/json" })
          .end(JSON.stringify({ status: "processed", passed: true, details: "stubbed" }));
      });
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    this.server = server;
    this.origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    return this.origin;
  }

  async stop(): Promise<void> {
    const server = this.server;
    if (!server) return;
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
}

const settingsAsParameters = (settings: Record<string, unknown>): Field[] =>
  Object.entries(settings).map(([identifier, value]) => ({ identifier, type: "str", value }));

/** Entry -> evaluator -> end, with the evaluator node under test in the middle. */
const canvasNodes = (judgeData: Component): StudioNode<Component>[] => [
  {
    id: "entry",
    type: "entry",
    position: { x: 0, y: 0 },
    data: { outputs: [{ identifier: "output", type: "str" }] },
  },
  { id: "judge", type: "evaluator", position: { x: 300, y: 0 }, data: judgeData },
  {
    id: "end",
    type: "end",
    position: { x: 600, y: 0 },
    data: { inputs: [{ identifier: "passed", type: "bool" }] },
  },
];

/**
 * A node pointing at a saved evaluator. Only this shape gets `localConfig`:
 * the panel writes unsaved edits there and the sender flattens them.
 */
const savedEvaluatorWithPanelEdits = (): Component => ({
  cls: "LangWatchEvaluator",
  name: "Saved judge",
  evaluator: SAVED_EVALUATOR_REF,
  inputs: [{ identifier: "output", type: "str" }],
  outputs: [{ identifier: "passed", type: "bool" }],
  localConfig: { name: "Saved judge", settings: CANVAS_SETTINGS },
});

/**
 * A node pointing straight at an evaluator slug. The old inline panel writes
 * its settings onto parameters[] directly, with no localConfig to merge.
 */
const inlineEvaluatorNode = (): Component => ({
  cls: "LangWatchEvaluator",
  name: "Inline judge",
  evaluator: INLINE_EVALUATOR_SLUG,
  inputs: [{ identifier: "output", type: "str" }],
  outputs: [{ identifier: "passed", type: "bool" }],
  parameters: settingsAsParameters(CANVAS_SETTINGS),
});

const EDGES = [
  {
    id: "e1",
    source: "entry",
    sourceHandle: "outputs.output",
    target: "judge",
    targetHandle: "inputs.output",
    type: "default",
  },
  {
    id: "e2",
    source: "judge",
    sourceHandle: "outputs.passed",
    target: "end",
    targetHandle: "inputs.passed",
    type: "default",
  },
];

const executeFlowBody = (nodes: StudioNode<Component>[]): string =>
  JSON.stringify({
    type: "execute_flow",
    payload: {
      trace_id: TRACE_ID,
      project_id: PROJECT_ID,
      origin: "workflow",
      workflow: {
        workflow_id: "wf_evaluator_settings",
        api_key: "test-key-evaluator-settings",
        spec_version: "1.3",
        name: "Evaluator settings round trip",
        icon: "x",
        description: "x",
        version: "x",
        template_adapter: "default",
        nodes,
        edges: EDGES,
        state: {},
      },
      inputs: { output: "yes" },
      manual_execution_mode: false,
      do_not_trace: true,
    },
  });

describe.skipIf(!hasGo())("the inline evaluator settings round trip", () => {
  const api = new FakeEvaluatorApi();
  let nlpgo: NlpgoSubprocess;

  beforeAll(async () => {
    const origin = await api.start();
    nlpgo = await startNlpgoSubprocess({
      environment: process.env,
      port: NLPGO_PORT,
      env: { ENVIRONMENT: "test", NLPGO_ENGINE_LANGWATCH_BASE_URL: origin },
    });
  }, 700_000);

  afterAll(async () => {
    await nlpgo?.stop();
    await api.stop();
  });

  beforeEach(() => {
    api.calls = [];
  });

  const runAndCaptureEvaluateCall = async (
    nodes: StudioNode<Component>[],
  ): Promise<CapturedEvaluation> => {
    const response = await fetch(`${nlpgo.baseUrl}/go/studio/execute_sync`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: executeFlowBody(nodes),
    });
    expect(response.ok, `engine answered ${response.status} ${response.statusText}`).toBe(true);
    expect(api.calls).toHaveLength(1);
    const [call] = api.calls;
    expect(call).toBeDefined();

    return call!;
  };

  describe("given a node pointing at a saved evaluator with unsaved panel edits", () => {
    describe("when the studio dispatches the run to the engine", () => {
      /** @scenario "A saved evaluator with unsaved panel edits dispatches those edits" */
      it("calls the saved evaluator with the settings the panel showed", async () => {
        // The real sender: it strips localConfig and flattens the settings
        // into one parameter per key. Nothing emits a `settings` parameter.
        const dispatched = mergeLocalConfigsIntoDsl(canvasNodes(savedEvaluatorWithPanelEdits()));
        const judge = dispatched.find((node) => node.id === "judge");
        expect(judge?.data.parameters).toEqual(
          expect.arrayContaining([
            expect.objectContaining({ identifier: "model", value: "openai/gpt-5-mini" }),
          ]),
        );
        expect(JSON.stringify(judge?.data.parameters)).not.toContain('"identifier":"settings"');

        // The far side of the hop. Pre-fix the body had no settings at all
        // and the endpoint's merge fell through to the saved defaults.
        const call = await runAndCaptureEvaluateCall(dispatched);
        expect(call.path).toBe(`/api/evaluations/${SAVED_EVALUATOR_REF}/evaluate`);
        expect(call.body.settings).toEqual(CANVAS_SETTINGS);
      }, 120_000);
    });
  });

  describe("given a node pointing at an evaluator slug with its settings inline", () => {
    describe("when the studio dispatches the run to the engine", () => {
      /** @scenario "An inline evaluator node dispatches the settings on the node" */
      it("calls the slug with the settings the panel showed", async () => {
        const dispatched = mergeLocalConfigsIntoDsl(canvasNodes(inlineEvaluatorNode()));

        const call = await runAndCaptureEvaluateCall(dispatched);
        expect(call.path).toBe(`/api/evaluations/${INLINE_EVALUATOR_SLUG}/evaluate`);
        expect(call.body.settings).toEqual(CANVAS_SETTINGS);
      }, 120_000);
    });
  });
});
