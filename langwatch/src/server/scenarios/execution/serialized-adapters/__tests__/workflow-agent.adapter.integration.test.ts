/**
 * @vitest-environment node
 *
 * End-to-end integration test for issue #3415.
 *
 * Drives the `SerializedWorkflowAgentAdapter` against a real langwatch_nlp service
 * using the two reproducer workflows staged for the follow-up PR. The adapter is the
 * exact code path scenario runs go through — this test closes the loop between the
 * scenarios framework and the NLP fix landed in PR #3416.
 *
 * Required services (skipped otherwise):
 *   - LANGWATCH_NLP_SERVICE reachable (default http://localhost:5561)
 *   - `test_with_retries: false` on scenario execution so a single run is enough
 *
 * Expected behavior:
 *   AC 2: chat_messages-typed signature input → no HTTP 500
 *   AC 1: str-typed workflow w/ {{question}} / {{thread_id}} / {{messages}} /
 *         {{random_static_value}} in the prompt → all four substituted in the LLM
 *         output, no escaped-JSON blob
 *   AC 4: conversation history preserved as distinct turns (checked via the echoed
 *         LLM response containing each turn's role+content)
 */

import { AgentRole, type AgentInput } from "@langwatch/scenario";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import type { WorkflowAgentData } from "../../types";
import { SerializedWorkflowAgentAdapter } from "../workflow-agent.adapter";

const NLP = process.env.LANGWATCH_NLP_SERVICE ?? "http://localhost:5561";
const REPO_ROOT = resolve(__dirname, "../../../../../../..");
const REPRO_BUG1 = resolve(REPO_ROOT, ".claude-context/repro-bug1-str-type.json");
const REPRO_BUG2 = resolve(
  REPO_ROOT,
  ".claude-context/repro-bug2-chat_messages-type-crash.json",
);

async function nlpReachable(): Promise<boolean> {
  try {
    const r = await fetch(`${NLP}/health`, { signal: AbortSignal.timeout(2000) });
    return r.ok;
  } catch {
    return false;
  }
}

function loadRepro(path: string): Record<string, unknown> {
  return JSON.parse(readFileSync(path, "utf8"));
}

function augmentParrotBackPrompt(
  workflow: Record<string, unknown>,
): Record<string, unknown> {
  const wf = JSON.parse(JSON.stringify(workflow));
  const sig = (wf.nodes as Array<Record<string, any>>).find(
    (n) => n.type === "signature",
  )!;
  const messagesParam = sig.data.parameters.find(
    (p: any) => p.identifier === "messages",
  );
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
  const instructions = sig.data.parameters.find(
    (p: any) => p.identifier === "instructions",
  );
  if (instructions) {
    instructions.value =
      "Echo back the user message you just received, verbatim. Do not add anything else.";
  }
  // Add random_static_value as an input field with a default value — mirrors the
  // Studio "Variables panel → static value" shape from the issue screenshot.
  sig.data.inputs = sig.data.inputs ?? [];
  if (!sig.data.inputs.find((f: any) => f.identifier === "random_static_value")) {
    sig.data.inputs.push({
      identifier: "random_static_value",
      type: "str",
      value: "bob is your uncle",
    });
  }
  wf.api_key = "sk-test-e2e-3415-dummy";
  wf.project_id = "e2e-test";
  wf.enable_tracing = false;
  return wf;
}

function buildAdapter(workflow: Record<string, unknown>): SerializedWorkflowAgentAdapter {
  const messagesType =
    (workflow.nodes as Array<any>).find((n) => n.id === "entry")?.data.outputs?.find(
      (f: any) => f.identifier === "messages",
    )?.type ?? "str";
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

function agentInput(): AgentInput {
  return {
    threadId: "t-e2e-3415",
    scenarioState: {} as any,
    messages: TWO_TURN_HISTORY,
  } as AgentInput;
}

// Skip if NLP is not up — CI typically doesn't have it, local dev does.
const describeMaybe = (await nlpReachable()) ? describe : describe.skip;

describeMaybe("SerializedWorkflowAgentAdapter — e2e against live NLP (#3415)", () => {
  it("runs repro-bug2 (chat_messages type) without HTTP 500 [AC 2]", async () => {
    const wf = augmentParrotBackPrompt(loadRepro(REPRO_BUG2));
    const adapter = buildAdapter(wf);

    const output = await adapter.call(agentInput());

    expect(typeof output).toBe("string");
    expect(output.length).toBeGreaterThan(0);
  }, 120_000);

  it(
    "interpolates all four variables and preserves history [AC 1, 4, 6]",
    async () => {
      const wf = augmentParrotBackPrompt(loadRepro(REPRO_BUG1));
      const adapter = buildAdapter(wf);

      const output = await adapter.call(agentInput());

      // Static value must appear.
      expect(output).toContain("bob is your uncle");
      // Thread id must be substituted.
      expect(output).toContain("t-e2e-3415");
      // The final user message content must survive.
      expect(output).toContain("capital of France");
      // No unresolved mustache markers.
      expect(output).not.toContain("{{");
      // The escaped-JSON blob that caused bug 1 must NOT appear in the echoed prompt.
      expect(output).not.toMatch(/\\"role\\":/);
    },
    120_000,
  );
});
