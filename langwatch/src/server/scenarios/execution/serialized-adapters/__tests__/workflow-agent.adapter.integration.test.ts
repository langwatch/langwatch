/**
 * @vitest-environment node
 *
 * End-to-end integration test for issue #3415.
 *
 * Drives the real `SerializedWorkflowAgentAdapter` against a running `langwatch_nlp`
 * service using the two reproducer workflows committed under `./fixtures/`. This is
 * the exact code path scenario runs go through — the test closes the loop between the
 * scenarios framework and the NLP fix landed in PR #3416.
 *
 * Skipped automatically when `LANGWATCH_NLP_SERVICE` (default `http://localhost:5561`)
 * is unreachable so CI without NLP doesn't red-X.
 *
 * Expected behavior:
 *   AC 2: chat_messages-typed signature input → no HTTP 500
 *   AC 1: str-typed workflow w/ {{question}} / {{thread_id}} / {{messages}} /
 *         {{random_static_value}} in the prompt → echoed output contains every value
 *         (case-insensitive) and no unresolved mustache markers
 *   AC 4: conversation history preserved as distinct turns — no escaped-JSON blob leak
 */

import { AgentRole, type AgentInput } from "@langwatch/scenario";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import type { WorkflowAgentData } from "../../types";
import { SerializedWorkflowAgentAdapter } from "../workflow-agent.adapter";

const NLP = process.env.LANGWATCH_NLP_SERVICE ?? "http://localhost:5561";
const FIXTURES = resolve(__dirname, "fixtures");
const REPRO_BUG1 = resolve(FIXTURES, "repro-bug1-str-type.json");
const REPRO_BUG2 = resolve(FIXTURES, "repro-bug2-chat_messages-type-crash.json");

// --- Helpers ---------------------------------------------------------------------

type WorkflowDsl = Record<string, unknown>;
type SignatureParam = { identifier: string; type: string; value?: unknown };
type SignatureNode = {
  id: string;
  type: string;
  data: {
    parameters?: SignatureParam[];
    inputs?: Array<{ identifier: string; type: string; value?: unknown }>;
    outputs?: Array<{ identifier: string; type: string }>;
  };
};

async function nlpReachable(): Promise<boolean> {
  try {
    const r = await fetch(`${NLP}/health`, { signal: AbortSignal.timeout(2000) });
    return r.ok;
  } catch {
    return false;
  }
}

function loadRepro(path: string): WorkflowDsl {
  return JSON.parse(readFileSync(path, "utf8")) as WorkflowDsl;
}

function cloneWorkflow(workflow: WorkflowDsl): WorkflowDsl {
  return JSON.parse(JSON.stringify(workflow)) as WorkflowDsl;
}

function getSignatureNode(workflow: WorkflowDsl): SignatureNode {
  const nodes = workflow.nodes as SignatureNode[] | undefined;
  const sig = nodes?.find((n) => n.type === "signature");
  if (!sig) throw new Error("repro workflow is missing a signature node");
  return sig;
}

/**
 * Swap the signature's prompt-template messages for a parrot-back prompt that references
 * every template variable. Enables AC 1 / AC 4 / AC 6 verification against a live LLM.
 */
function patchSignaturePrompt(sig: SignatureNode): void {
  const params = sig.data.parameters ?? [];
  const messagesParam = params.find((p) => p.identifier === "messages");
  if (!messagesParam) throw new Error("signature is missing the 'messages' parameter");
  messagesParam.value = [
    {
      role: "user",
      content:
        "question: {{question}}\n" +
        "thread_id: {{thread_id}}\n" +
        "messages: {{messages}}\n" +
        "random_static_value: {{random_static_value}}",
    },
  ];
  const instructions = params.find((p) => p.identifier === "instructions");
  if (instructions) {
    instructions.value =
      "Echo back the user message you just received, verbatim. Do not add anything else.";
  }
}

/**
 * Add a `random_static_value` input with a default value, mirroring the Studio
 * "Variables panel → static value" shape from the issue screenshot.
 */
function addStaticInput(sig: SignatureNode, identifier: string, value: string): void {
  const inputs = (sig.data.inputs ??= []);
  if (!inputs.some((f) => f.identifier === identifier)) {
    inputs.push({ identifier, type: "str", value });
  }
}

function buildAdapter(workflow: WorkflowDsl): SerializedWorkflowAgentAdapter {
  const entry = (workflow.nodes as Array<{ id: string; data: { outputs?: Array<{ identifier: string; type: string }> } }>).find(
    (n) => n.id === "entry",
  );
  const messagesType =
    entry?.data.outputs?.find((f) => f.identifier === "messages")?.type ?? "str";
  const config: WorkflowAgentData = {
    type: "workflow",
    agentId: "e2e-agent",
    workflowId: "e2e-wf",
    workflow,
    inputs: [
      { identifier: "question", type: "str" },
      { identifier: "messages", type: messagesType },
      { identifier: "thread_id", type: "str" },
    ],
    outputs: [{ identifier: "output", type: "str" }],
    scenarioMappings: {
      question: { type: "source", sourceId: "scenario", path: ["input"] },
      messages: { type: "source", sourceId: "scenario", path: ["messages"] },
      thread_id: { type: "source", sourceId: "scenario", path: ["threadId"] },
    },
    secrets: {},
  };
  return new SerializedWorkflowAgentAdapter(config, NLP, "sk-e2e-3415");
}

const TWO_TURN_HISTORY: AgentInput["messages"] = [
  { role: "user", content: "hi" },
  { role: "assistant", content: "hello there" },
  { role: "user", content: "What is the capital of France?" },
];

function makeAgentInput(): AgentInput {
  const lastTurn = TWO_TURN_HISTORY[TWO_TURN_HISTORY.length - 1];
  if (!lastTurn) throw new Error("TWO_TURN_HISTORY must be non-empty");
  return {
    threadId: "t-e2e-3415",
    messages: TWO_TURN_HISTORY,
    newMessages: [lastTurn],
    requestedRole: AgentRole.AGENT,
    scenarioState: {
      currentTurn: 1,
      addMessages: () => undefined,
      setCompleted: () => undefined,
      getCompleted: () => false,
      setResult: () => undefined,
      getResult: () => undefined,
    } as unknown as AgentInput["scenarioState"],
    scenarioConfig: {
      name: "e2e-3415",
      description: "",
      maxTurns: 2,
    } as unknown as AgentInput["scenarioConfig"],
  };
}

// --- Suite -----------------------------------------------------------------------

describe("SerializedWorkflowAgentAdapter — e2e against live NLP (#3415)", () => {
  let nlpUp = false;

  beforeAll(async () => {
    nlpUp = await nlpReachable();
  });

  it("runs repro-bug2 (chat_messages type) without HTTP 500 [AC 2]", async () => {
    if (!nlpUp) return;
    const wf = cloneWorkflow(loadRepro(REPRO_BUG2));
    const sig = getSignatureNode(wf);
    patchSignaturePrompt(sig);
    addStaticInput(sig, "random_static_value", "bob is your uncle");

    const output = await buildAdapter(wf).call(makeAgentInput());

    expect(typeof output).toBe("string");
    expect(output.length).toBeGreaterThan(0);
    // Hard bug-1 invariant: no escaped-JSON blob leak.
    expect(output).not.toMatch(/\\"role\\":/);
  }, 120_000);

  it(
    "interpolates template variables and preserves history [AC 1, 4, 6]",
    async () => {
      if (!nlpUp) return;
      const wf = cloneWorkflow(loadRepro(REPRO_BUG1));
      const sig = getSignatureNode(wf);
      patchSignaturePrompt(sig);
      addStaticInput(sig, "random_static_value", "bob is your uncle");

      const output = await buildAdapter(wf).call(makeAgentInput());

      // Hard negative invariants — the actual regression signals proving the fix.
      expect(output).not.toContain("{{");
      expect(output).not.toMatch(/\\"role\\":/);

      // Soft positive echo checks — LLMs can reformat, match case-insensitively.
      // Opaque thread_id (t-e2e-3415) is not asserted on the LLM echo; its substitution
      // is covered at the pytest layer (test_str_inputs_interpolate).
      expect(output).toMatch(/bob is your uncle/i);
      expect(output).toMatch(/capital of france/i);

      // AC 4 role-preservation: the prior assistant turn's content must be reachable
      // through the pipeline. The parrot-back prompt serializes `{{messages}}` into the
      // echoed string, so each history turn's content appears there. Pre-fix bug 1, the
      // whole history collapsed into a single escaped-JSON user message; post-fix the
      // assistant's own words round-trip.
      expect(output).toMatch(/hello there/i);
    },
    120_000,
  );
});
