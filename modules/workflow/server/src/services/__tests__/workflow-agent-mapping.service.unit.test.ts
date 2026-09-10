/**
 * @vitest-environment node
 */

import { describe, expect, it, vi } from "vitest";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import type { AgentApi } from "@langwatch/agent-contract";
import type { StudioWorkflow } from "@langwatch/workflow-contract";
import { WorkflowAgentMappingAdapter } from "../workflow-agent-mapping.service.ts";

/** The adapter under test, over the fake rows one case supplies. */
const recompute = (input: {
  agents: AgentApi;
  workflowId: string;
  projectId: string;
  dsl: unknown;
}): Promise<void> =>
  WorkflowAgentMappingAdapter.create({
    agents: input.agents,
  }).recompute({
    workflowId: input.workflowId,
    projectId: input.projectId,
    dsl: input.dsl as StudioWorkflow,
  });

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// Entry edges identify the mapping surface even without entry node declarations.
function buildDSL({ inputs, output }: { inputs: string[]; output: string }) {
  const edges = inputs.map((identifier, i) => ({
    id: `e-entry-${i}`,
    source: "entry",
    sourceHandle: `outputs.${identifier}`,
    target: "llm_call",
    targetHandle: `inputs.${identifier}`,
    type: "default",
  }));

  const nodes = [
    {
      id: "end",
      type: "end",
      position: { x: 0, y: 0 },
      data: {
        name: "End",
        inputs: [{ identifier: output, type: "str" }],
      },
    },
  ];

  return { nodes, edges };
}

// ---------------------------------------------------------------------------
// Agent API fixture
// ---------------------------------------------------------------------------

function buildAgentApi({
  agents,
}: {
  agents: Array<{ id: string; config: Record<string, unknown> }>;
}) {
  const updatedConfigs: Record<string, Record<string, unknown>> = {};

  const agentsApi = createApiFixture<AgentApi>({
    listWorkflowConfigs: vi.fn<AgentApi["listWorkflowConfigs"]>().mockResolvedValue(agents),
    updateWorkflowConfig: vi.fn<AgentApi["updateWorkflowConfig"]>(async (input) => {
      expect(input.projectId).toBe("proj-1");
      expect(input.workflowId).toBe("wf-1");
      updatedConfigs[input.id] = input.config;
    }),
  });

  return { agentsApi, updatedConfigs };
}

// Declared, unwired entry outputs must still become scenario inputs.
function buildUnwiredDSL({
  entryOutputs,
  wiredIdentifiers,
  output,
}: {
  entryOutputs: Array<{ identifier: string; type: "str" }>;
  wiredIdentifiers: string[];
  output: string;
}) {
  const wiredSet = new Set(wiredIdentifiers);

  const edges = entryOutputs
    .filter((o) => wiredSet.has(o.identifier))
    .map((o, i) => ({
      id: `e-entry-${i}`,
      source: "entry",
      sourceHandle: `outputs.${o.identifier}`,
      target: "llm_call",
      targetHandle: `inputs.${o.identifier}`,
      type: "default",
    }));

  const nodes = [
    {
      id: "entry",
      type: "entry",
      position: { x: 0, y: 0 },
      data: {
        name: "Entry",
        outputs: entryOutputs,
      },
    },
    {
      id: "llm_call",
      type: "llm",
      position: { x: 400, y: 0 },
      data: { name: "LLM Call" },
    },
    {
      id: "end",
      type: "end",
      position: { x: 800, y: 0 },
      data: {
        name: "End",
        inputs: [{ identifier: output, type: "str" }],
      },
    },
  ];

  return { nodes, edges };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("WorkflowAgentMappingAdapter", () => {
  describe("when a workflow agent has no scenarioMappings and conventional inputs", () => {
    /** @scenario Auto-computes mappings when workflow with conventional inputs is saved */
    it("maps query to scenario input field", async () => {
      const dsl = buildDSL({
        inputs: ["query", "history"],
        output: "response",
      });
      const { agentsApi, updatedConfigs } = buildAgentApi({
        agents: [{ id: "agent-1", config: { type: "workflow" } }],
      });

      await recompute({
        agents: agentsApi,
        workflowId: "wf-1",
        projectId: "proj-1",
        dsl,
      });

      const config = updatedConfigs["agent-1"];
      expect(config).toBeDefined();
      const mappings = config!.scenarioMappings as Record<
        string,
        { type: string; sourceId: string; path: string[] }
      >;
      expect(mappings.query).toEqual({
        type: "source",
        sourceId: "scenario",
        path: ["input"],
      });
    });

    it("maps history to scenario messages field", async () => {
      const dsl = buildDSL({
        inputs: ["query", "history"],
        output: "response",
      });
      const { agentsApi, updatedConfigs } = buildAgentApi({
        agents: [{ id: "agent-1", config: { type: "workflow" } }],
      });

      await recompute({
        agents: agentsApi,
        workflowId: "wf-1",
        projectId: "proj-1",
        dsl,
      });

      const config = updatedConfigs["agent-1"];
      expect(config).toBeDefined();
      const mappings = config!.scenarioMappings as Record<
        string,
        { type: string; sourceId: string; path: string[] }
      >;
      expect(mappings.history).toEqual({
        type: "source",
        sourceId: "scenario",
        path: ["messages"],
      });
    });

    it("sets scenarioOutputField to the first workflow output", async () => {
      const dsl = buildDSL({
        inputs: ["query", "history"],
        output: "response",
      });
      const { agentsApi, updatedConfigs } = buildAgentApi({
        agents: [{ id: "agent-1", config: { type: "workflow" } }],
      });

      await recompute({
        agents: agentsApi,
        workflowId: "wf-1",
        projectId: "proj-1",
        dsl,
      });

      const config = updatedConfigs["agent-1"];
      expect(config).toBeDefined();
      expect(config!.scenarioOutputField).toBe("response");
    });

    it("queries agents by workflowId and projectId excluding archived", async () => {
      const dsl = buildDSL({ inputs: ["query"], output: "response" });
      const { agentsApi } = buildAgentApi({
        agents: [{ id: "agent-1", config: {} }],
      });

      await recompute({
        agents: agentsApi,
        workflowId: "wf-1",
        projectId: "proj-1",
        dsl,
      });

      expect(agentsApi.listWorkflowConfigs).toHaveBeenCalledWith(
        expect.objectContaining({
          workflowId: "wf-1",
          projectId: "proj-1",
        }),
      );
    });
  });

  describe("when an agent already has scenarioMappings configured", () => {
    it("skips the agent without overwriting existing mappings", async () => {
      const dsl = buildDSL({ inputs: ["query"], output: "response" });
      const existingMappings = {
        query: { type: "source", sourceId: "scenario", path: ["input"] },
      };
      const { agentsApi } = buildAgentApi({
        agents: [
          {
            id: "agent-1",
            config: { type: "workflow", scenarioMappings: existingMappings },
          },
        ],
      });

      await recompute({
        agents: agentsApi,
        workflowId: "wf-1",
        projectId: "proj-1",
        dsl,
      });

      expect(agentsApi.updateWorkflowConfig).not.toHaveBeenCalled();
    });
  });

  describe("when the workflow still has blank-template placeholder fields", () => {
    /** @scenario Skips auto-compute when workflow still has blank-template placeholder fields */
    it("skips auto-compute and leaves scenarioMappings empty", async () => {
      // Blank template: entry outputs "question", end inputs "output"
      const dsl = buildDSL({ inputs: ["question"], output: "output" });
      const { agentsApi } = buildAgentApi({
        agents: [{ id: "agent-1", config: { type: "workflow" } }],
      });

      await recompute({
        agents: agentsApi,
        workflowId: "wf-1",
        projectId: "proj-1",
        dsl,
      });

      expect(agentsApi.updateWorkflowConfig).not.toHaveBeenCalled();
    });
  });

  describe("when existing scenarioMappings reference stale fields", () => {
    /** @scenario Re-computes mappings when existing mappings reference stale fields */
    it("re-computes mappings against the current workflow inputs", async () => {
      // Workflow now has "prompt" — but agent still maps "old_query"
      const dsl = buildDSL({ inputs: ["prompt"], output: "response" });
      const staleExistingMappings = {
        old_query: { type: "source", sourceId: "scenario", path: ["input"] },
      };
      const { agentsApi, updatedConfigs } = buildAgentApi({
        agents: [
          {
            id: "agent-1",
            config: {
              type: "workflow",
              scenarioMappings: staleExistingMappings,
            },
          },
        ],
      });

      await recompute({
        agents: agentsApi,
        workflowId: "wf-1",
        projectId: "proj-1",
        dsl,
      });

      expect(agentsApi.updateWorkflowConfig).toHaveBeenCalled();
      const config = updatedConfigs["agent-1"];
      expect(config).toBeDefined();
      const mappings = config!.scenarioMappings as Record<string, unknown>;
      // Stale key must be gone
      expect(mappings.old_query).toBeUndefined();
      // New field "prompt" must be present
      expect(mappings.prompt).toBeDefined();
    });

    it("preserves non-stale mappings (does not re-compute when all keys are current)", async () => {
      const dsl = buildDSL({ inputs: ["prompt"], output: "response" });
      const currentMappings = {
        prompt: { type: "source", sourceId: "scenario", path: ["input"] },
      };
      const { agentsApi } = buildAgentApi({
        agents: [
          {
            id: "agent-1",
            config: {
              type: "workflow",
              scenarioMappings: currentMappings,
            },
          },
        ],
      });

      await recompute({
        agents: agentsApi,
        workflowId: "wf-1",
        projectId: "proj-1",
        dsl,
      });

      expect(agentsApi.updateWorkflowConfig).not.toHaveBeenCalled();
    });

    it("preserves user-set mappings for non-stale keys when another key is stale", async () => {
      // Workflow now declares "prompt" and "extra" — but the agent's mapping
      // for "old_query" is stale. Re-computing must preserve the user's
      // custom mapping for "extra" rather than clobbering it with a best-match
      // guess.
      const dsl = buildDSL({ inputs: ["prompt", "extra"], output: "response" });
      const existingMappings = {
        old_query: { type: "source", sourceId: "scenario", path: ["input"] },
        extra: {
          type: "source",
          sourceId: "scenario",
          path: ["custom", "user_picked"],
        },
      };
      const { agentsApi, updatedConfigs } = buildAgentApi({
        agents: [
          {
            id: "agent-1",
            config: {
              type: "workflow",
              scenarioMappings: existingMappings,
            },
          },
        ],
      });

      await recompute({
        agents: agentsApi,
        workflowId: "wf-1",
        projectId: "proj-1",
        dsl,
      });

      expect(agentsApi.updateWorkflowConfig).toHaveBeenCalled();
      const config = updatedConfigs["agent-1"];
      expect(config).toBeDefined();
      const mappings = config!.scenarioMappings as Record<
        string,
        { type: string; sourceId: string; path: string[] }
      >;
      expect(mappings.old_query).toBeUndefined();
      expect(mappings.prompt).toBeDefined();
      expect(mappings.extra).toEqual({
        type: "source",
        sourceId: "scenario",
        path: ["custom", "user_picked"],
      });
    });
  });

  describe("when the workflow has no end outputs at all", () => {
    it("clears a stale scenarioOutputField rather than leaving it pointing to a removed output", async () => {
      // Build a DSL whose end node has no inputs — i.e. no outputs.
      const dsl = {
        nodes: [
          {
            id: "end",
            type: "end",
            position: { x: 0, y: 0 },
            data: { name: "End", inputs: [] as Array<unknown> },
          },
        ],
        edges: [
          {
            id: "e-entry-0",
            source: "entry",
            sourceHandle: "outputs.query",
            target: "llm_call",
            targetHandle: "inputs.query",
            type: "default",
          },
        ],
      };
      const { agentsApi, updatedConfigs } = buildAgentApi({
        agents: [
          {
            id: "agent-1",
            config: {
              type: "workflow",
              scenarioMappings: {
                query: {
                  type: "source",
                  sourceId: "scenario",
                  path: ["input"],
                },
              },
              scenarioOutputField: "response",
            },
          },
        ],
      });

      await recompute({
        agents: agentsApi,
        workflowId: "wf-1",
        projectId: "proj-1",
        dsl,
      });

      expect(agentsApi.updateWorkflowConfig).toHaveBeenCalled();
      const config = updatedConfigs["agent-1"];
      expect(config).toBeDefined();
      // Stale scenarioOutputField must be removed, not left pointing at
      // a non-existent output field.
      expect(config!.scenarioOutputField).toBeUndefined();
    });
  });

  describe("when scenarioOutputField is stale but input mappings are current", () => {
    it("repairs scenarioOutputField to the new first output", async () => {
      // Inputs unchanged, but the end output was renamed from "old_out" → "new_out".
      const dsl = buildDSL({ inputs: ["prompt"], output: "new_out" });
      const currentMappings = {
        prompt: { type: "source", sourceId: "scenario", path: ["input"] },
      };
      const { agentsApi, updatedConfigs } = buildAgentApi({
        agents: [
          {
            id: "agent-1",
            config: {
              type: "workflow",
              scenarioMappings: currentMappings,
              scenarioOutputField: "old_out",
            },
          },
        ],
      });

      await recompute({
        agents: agentsApi,
        workflowId: "wf-1",
        projectId: "proj-1",
        dsl,
      });

      expect(agentsApi.updateWorkflowConfig).toHaveBeenCalled();
      const config = updatedConfigs["agent-1"];
      expect(config!.scenarioOutputField).toBe("new_out");
      // Input mappings are preserved verbatim.
      const mappings = config!.scenarioMappings as Record<string, unknown>;
      expect(mappings.prompt).toEqual({
        type: "source",
        sourceId: "scenario",
        path: ["input"],
      });
    });
  });

  describe("when no agents are linked to the workflow", () => {
    it("does not attempt any updates", async () => {
      const dsl = buildDSL({ inputs: ["query"], output: "response" });
      const { agentsApi } = buildAgentApi({ agents: [] });

      await recompute({
        agents: agentsApi,
        workflowId: "wf-1",
        projectId: "proj-1",
        dsl,
      });

      expect(agentsApi.updateWorkflowConfig).not.toHaveBeenCalled();
    });
  });

  describe("when Agent persistence throws an error", () => {
    /** @scenario Auto-compute does not block the workflow save on failure */
    it("does not propagate the error (non-blocking)", async () => {
      const dsl = buildDSL({ inputs: ["query"], output: "response" });
      const agentsApi = createApiFixture<AgentApi>({
        listWorkflowConfigs: vi
          .fn<AgentApi["listWorkflowConfigs"]>()
          .mockRejectedValue(new Error("DB connection lost")),
      });

      await expect(
        recompute({
          agents: agentsApi,
          workflowId: "wf-1",
          projectId: "proj-1",
          dsl,
        }),
      ).resolves.toBeUndefined();
    });
  });

  describe("when the entry node declares a field with no downstream edge (unwired)", () => {
    /** @scenario Auto-compute includes unwired entry fields */
    it("includes the unwired field in the auto-computed scenarioMappings", async () => {
      // Entry node declares "new_field" but no downstream edge exists for it.
      const dsl = buildUnwiredDSL({
        entryOutputs: [{ identifier: "new_field", type: "str" }],
        wiredIdentifiers: [],
        output: "response",
      });
      const { agentsApi, updatedConfigs } = buildAgentApi({
        agents: [{ id: "agent-1", config: { type: "workflow" } }],
      });

      await recompute({
        agents: agentsApi,
        workflowId: "wf-1",
        projectId: "proj-1",
        dsl,
      });

      const config = updatedConfigs["agent-1"];
      expect(config).toBeDefined();
      const mappings = config!.scenarioMappings as Record<string, unknown>;
      // Bug #3362: unwired entry outputs are dropped from auto-computed mappings.
      // After the fix, "new_field" must appear with a best-match default.
      expect(mappings.new_field).toBeDefined();
    });
  });

  describe("when the entry node declares a wired field (regression baseline)", () => {
    /** @scenario Wired entry field still appears in auto-computed scenarioMappings */
    it("includes the wired field in the auto-computed scenarioMappings", async () => {
      // Entry node declares "query" and it IS wired to an LLM node downstream.
      const dsl = buildUnwiredDSL({
        entryOutputs: [{ identifier: "query", type: "str" }],
        wiredIdentifiers: ["query"],
        output: "response",
      });
      const { agentsApi, updatedConfigs } = buildAgentApi({
        agents: [{ id: "agent-1", config: { type: "workflow" } }],
      });

      await recompute({
        agents: agentsApi,
        workflowId: "wf-1",
        projectId: "proj-1",
        dsl,
      });

      const config = updatedConfigs["agent-1"];
      expect(config).toBeDefined();
      const mappings = config!.scenarioMappings as Record<string, unknown>;
      // Regression: wired entry fields must always appear in scenarioMappings.
      expect(mappings.query).toBeDefined();
    });
  });
});
