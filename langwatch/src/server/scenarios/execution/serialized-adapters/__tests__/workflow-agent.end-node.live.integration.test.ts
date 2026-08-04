/**
 * @vitest-environment node
 *
 * The #3198 chain end to end, with nothing mocked between the two halves:
 * the real `SerializedWorkflowAgentAdapter` → real HTTP → a real nlpgo built
 * from this branch → the real planner and engine → back through the adapter.
 *
 * The unit tests next door stub `fetch`, so they prove the adapter reads an
 * envelope correctly but not that the engine actually emits the envelope they
 * describe. This closes that gap when it runs.
 *
 * ⚠ READ THIS BEFORE TREATING IT AS A GUARD. Every case here opens with
 * `if (!reachable) skip()`, and nothing binds an nlpgo to the probed port in CI,
 * so in CI all of them SKIP — unconditionally. It is a LOCAL backstop you run
 * deliberately, NOT a regression guard, and it must not be cited as CI evidence
 * that the engine still emits `{status:"error"}`. The CI-enforced half of that
 * claim is the fetch-stubbed unit suite next door, which does include the
 * "does not resolve with an empty string" case.
 *
 * To make it a real guard it needs to boot its own engine rather than probe for
 * one: `startNlpgoSubprocess`/`hasGo` in `~/server/nlpgo/__tests__/_nlpgoSubprocess`
 * exist for exactly this and are already used by two integration tests. That is a
 * deliberate follow-up — 8+ pre-existing live-nlpgo tests share this
 * probe-and-skip pattern, so it is a migration rather than a one-file change.
 *
 * Point it at an engine with LANGWATCH_NLP_SERVICE:
 *
 *   make service svc=nlpgo      # binds :5561, the default this file probes
 *   # or: go build -o /tmp/nlpgo ./cmd/service && SERVER_ADDR=:5561 /tmp/nlpgo nlpgo
 */

import { type AgentInput, AgentRole } from "@langwatch/scenario";
import { beforeAll, describe, expect, it } from "vitest";
import type { WorkflowAgentData } from "../../types";
import { SerializedWorkflowAgentAdapter } from "../workflow-agent.adapter";

const NLP = process.env.LANGWATCH_NLP_SERVICE ?? "http://127.0.0.1:5561";

let reachable = false;

async function nlpReachable(): Promise<boolean> {
  try {
    const r = await fetch(`${NLP}/healthz`, {
      signal: AbortSignal.timeout(2000),
    });
    return r.ok;
  } catch {
    return false;
  }
}

const entryNode = {
  id: "entry",
  type: "entry",
  data: {
    outputs: [{ identifier: "input", type: "str" }],
    dataset: { inline: { records: { input: ["hello"] } } },
    entry_selection: 0,
    train_size: 1.0,
    test_size: 0.0,
    seed: 1,
  },
};

const endNode = {
  id: "end",
  type: "end",
  data: { inputs: [{ identifier: "output", type: "str" }] },
};

function workflow(nodes: unknown[], edges: unknown[]): Record<string, unknown> {
  return {
    workflow_id: "wf_live",
    spec_version: "1.3",
    name: "live",
    icon: "x",
    description: "x",
    version: "1",
    template_adapter: "default",
    nodes,
    edges,
    state: {},
  };
}

function adapterFor(
  dsl: Record<string, unknown>,
): SerializedWorkflowAgentAdapter {
  const config: WorkflowAgentData = {
    type: "workflow",
    agentId: "agent_live",
    workflowId: "wf_live",
    workflow: dsl,
    inputs: [{ identifier: "input", type: "str" }],
    outputs: [{ identifier: "output", type: "str" }],
    secrets: {},
  };
  return new SerializedWorkflowAgentAdapter(config, NLP, "test-api-key");
}

const input: AgentInput = {
  threadId: "thread_live",
  messages: [{ role: "user", content: "hello" }],
  newMessages: [{ role: "user", content: "hello" }],
  requestedRole: AgentRole.AGENT,
  scenarioState: {} as AgentInput["scenarioState"],
  scenarioConfig: {} as AgentInput["scenarioConfig"],
};

describe("SerializedWorkflowAgentAdapter against a live nlpgo", () => {
  beforeAll(async () => {
    reachable = await nlpReachable();
  });

  describe("given a workflow whose End node is not wired to anything", () => {
    /** @scenario A workflow agent whose End node is unwired reports a readable failure */
    it("fails the agent turn with the engine's message instead of an empty reply", async ({
      skip,
    }) => {
      if (!reachable) skip();

      // entry, plus an End node with no inbound edge — the exact shape from
      // the review's reproduction.
      const adapter = adapterFor(workflow([entryNode, endNode], []));

      const settled = await adapter
        .call(input)
        .then((value) => ({ resolved: value }))
        .catch((err: unknown) => ({ rejected: String(err) }));

      // Asserted on the settled outcome, not with rejects.toThrow: the
      // pre-fix behaviour was a RESOLVED "", which a throw-shaped assertion
      // reports as an unrelated failure rather than as the bug.
      expect(settled).not.toHaveProperty("resolved");
      expect(settled).toHaveProperty("rejected");
      expect((settled as { rejected: string }).rejected).toContain(
        "End node has no wired inputs",
      );
    });
  });

  describe("given a workflow with no End node at all", () => {
    /** @scenario A workflow agent with no End node reports a readable failure */
    it("fails the agent turn naming the missing End node", async ({ skip }) => {
      if (!reachable) skip();

      const adapter = adapterFor(
        workflow(
          [
            entryNode,
            {
              id: "code",
              type: "code",
              data: { outputs: [{ identifier: "out", type: "str" }] },
            },
          ],
          [
            {
              id: "e1",
              source: "entry",
              sourceHandle: "outputs.input",
              target: "code",
              targetHandle: "inputs.input",
              type: "default",
            },
          ],
        ),
      );

      await expect(adapter.call(input)).rejects.toThrow(
        "workflow has no End node",
      );
    });
  });

  describe("given a well-formed workflow", () => {
    /** @scenario A well-formed workflow agent still returns its End node output */
    it("returns the End node output, so the guard is scoped to broken topologies", async ({
      skip,
    }) => {
      if (!reachable) skip();

      const adapter = adapterFor(
        workflow(
          [entryNode, endNode],
          [
            {
              id: "e1",
              source: "entry",
              sourceHandle: "outputs.input",
              target: "end",
              targetHandle: "inputs.output",
              type: "default",
            },
          ],
        ),
      );

      await expect(adapter.call(input)).resolves.toBe("hello");
    });
  });
});
