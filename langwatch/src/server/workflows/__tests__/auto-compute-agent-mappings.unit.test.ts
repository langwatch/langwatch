/**
 * @vitest-environment node
 */

import { describe, expect, it, vi, beforeEach } from "vitest";
import { autoComputeAgentMappings } from "../auto-compute-agent-mappings";
import type { PrismaClient } from "@prisma/client";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Builds a minimal DSL with the given input identifiers and a single output.
 *
 * Each entry edge has sourceHandle "outputs.<identifier>", which is the shape
 * that getInputsOutputs / getEntryInputs expect.
 */
function buildDSL({
  inputs,
  output,
}: {
  inputs: string[];
  output: string;
}) {
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
// Prisma mock factory
// ---------------------------------------------------------------------------

function buildPrismaMock({
  agents,
}: {
  agents: Array<{ id: string; config: Record<string, unknown> }>;
}) {
  const updatedConfigs: Record<string, Record<string, unknown>> = {};

  const prisma = {
    agent: {
      findMany: vi.fn().mockResolvedValue(agents),
      update: vi.fn().mockImplementation(
        async ({
          where,
          data,
        }: {
          where: { id: string; projectId?: string };
          data: { config: Record<string, unknown> };
        }) => {
          expect(where.projectId).toBeDefined();
          updatedConfigs[where.id] = data.config as Record<string, unknown>;
          return { id: where.id, config: data.config };
        },
      ),
    },
  } as unknown as PrismaClient;

  return { prisma, updatedConfigs };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("autoComputeAgentMappings", () => {
  describe("when a workflow agent has no scenarioMappings and conventional inputs", () => {
    it("maps query to scenario input field", async () => {
      const dsl = buildDSL({ inputs: ["query", "history"], output: "response" });
      const { prisma, updatedConfigs } = buildPrismaMock({
        agents: [{ id: "agent-1", config: { type: "workflow" } }],
      });

      await autoComputeAgentMappings({
        prisma,
        workflowId: "wf-1",
        projectId: "proj-1",
        dsl,
      });

      const config = updatedConfigs["agent-1"];
      expect(config).toBeDefined();
      const mappings = config!["scenarioMappings"] as Record<
        string,
        { type: string; sourceId: string; path: string[] }
      >;
      expect(mappings["query"]).toEqual({
        type: "source",
        sourceId: "scenario",
        path: ["input"],
      });
    });

    it("maps history to scenario messages field", async () => {
      const dsl = buildDSL({ inputs: ["query", "history"], output: "response" });
      const { prisma, updatedConfigs } = buildPrismaMock({
        agents: [{ id: "agent-1", config: { type: "workflow" } }],
      });

      await autoComputeAgentMappings({
        prisma,
        workflowId: "wf-1",
        projectId: "proj-1",
        dsl,
      });

      const config = updatedConfigs["agent-1"];
      expect(config).toBeDefined();
      const mappings = config!["scenarioMappings"] as Record<
        string,
        { type: string; sourceId: string; path: string[] }
      >;
      expect(mappings["history"]).toEqual({
        type: "source",
        sourceId: "scenario",
        path: ["messages"],
      });
    });

    it("sets scenarioOutputField to the first workflow output", async () => {
      const dsl = buildDSL({ inputs: ["query", "history"], output: "response" });
      const { prisma, updatedConfigs } = buildPrismaMock({
        agents: [{ id: "agent-1", config: { type: "workflow" } }],
      });

      await autoComputeAgentMappings({
        prisma,
        workflowId: "wf-1",
        projectId: "proj-1",
        dsl,
      });

      const config = updatedConfigs["agent-1"];
      expect(config).toBeDefined();
      expect(config!["scenarioOutputField"]).toBe("response");
    });

    it("queries agents by workflowId and projectId excluding archived", async () => {
      const dsl = buildDSL({ inputs: ["query"], output: "response" });
      const { prisma } = buildPrismaMock({
        agents: [{ id: "agent-1", config: {} }],
      });

      await autoComputeAgentMappings({
        prisma,
        workflowId: "wf-1",
        projectId: "proj-1",
        dsl,
      });

      expect(prisma.agent.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            workflowId: "wf-1",
            projectId: "proj-1",
            archivedAt: null,
          },
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
      const { prisma } = buildPrismaMock({
        agents: [
          {
            id: "agent-1",
            config: { type: "workflow", scenarioMappings: existingMappings },
          },
        ],
      });

      await autoComputeAgentMappings({
        prisma,
        workflowId: "wf-1",
        projectId: "proj-1",
        dsl,
      });

      expect(prisma.agent.update).not.toHaveBeenCalled();
    });
  });

  describe("when the workflow still has blank-template placeholder fields", () => {
    it("skips auto-compute and leaves scenarioMappings empty", async () => {
      // Blank template: entry outputs "question", end inputs "output"
      const dsl = buildDSL({ inputs: ["question"], output: "output" });
      const { prisma } = buildPrismaMock({
        agents: [{ id: "agent-1", config: { type: "workflow" } }],
      });

      await autoComputeAgentMappings({
        prisma,
        workflowId: "wf-1",
        projectId: "proj-1",
        dsl,
      });

      expect(prisma.agent.update).not.toHaveBeenCalled();
    });
  });

  describe("when existing scenarioMappings reference stale fields", () => {
    it("re-computes mappings against the current workflow inputs", async () => {
      // Workflow now has "prompt" — but agent still maps "old_query"
      const dsl = buildDSL({ inputs: ["prompt"], output: "response" });
      const staleExistingMappings = {
        old_query: { type: "source", sourceId: "scenario", path: ["input"] },
      };
      const { prisma, updatedConfigs } = buildPrismaMock({
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

      await autoComputeAgentMappings({
        prisma,
        workflowId: "wf-1",
        projectId: "proj-1",
        dsl,
      });

      expect(prisma.agent.update).toHaveBeenCalled();
      const config = updatedConfigs["agent-1"];
      expect(config).toBeDefined();
      const mappings = config!["scenarioMappings"] as Record<string, unknown>;
      // Stale key must be gone
      expect(mappings["old_query"]).toBeUndefined();
      // New field "prompt" must be present
      expect(mappings["prompt"]).toBeDefined();
    });

    it("preserves non-stale mappings (does not re-compute when all keys are current)", async () => {
      const dsl = buildDSL({ inputs: ["prompt"], output: "response" });
      const currentMappings = {
        prompt: { type: "source", sourceId: "scenario", path: ["input"] },
      };
      const { prisma } = buildPrismaMock({
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

      await autoComputeAgentMappings({
        prisma,
        workflowId: "wf-1",
        projectId: "proj-1",
        dsl,
      });

      expect(prisma.agent.update).not.toHaveBeenCalled();
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
      const { prisma, updatedConfigs } = buildPrismaMock({
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

      await autoComputeAgentMappings({
        prisma,
        workflowId: "wf-1",
        projectId: "proj-1",
        dsl,
      });

      expect(prisma.agent.update).toHaveBeenCalled();
      const config = updatedConfigs["agent-1"];
      expect(config).toBeDefined();
      const mappings = config!["scenarioMappings"] as Record<
        string,
        { type: string; sourceId: string; path: string[] }
      >;
      expect(mappings["old_query"]).toBeUndefined();
      expect(mappings["prompt"]).toBeDefined();
      expect(mappings["extra"]).toEqual({
        type: "source",
        sourceId: "scenario",
        path: ["custom", "user_picked"],
      });
    });
  });

  describe("when scenarioOutputField is stale but input mappings are current", () => {
    it("repairs scenarioOutputField to the new first output", async () => {
      // Inputs unchanged, but the end output was renamed from "old_out" → "new_out".
      const dsl = buildDSL({ inputs: ["prompt"], output: "new_out" });
      const currentMappings = {
        prompt: { type: "source", sourceId: "scenario", path: ["input"] },
      };
      const { prisma, updatedConfigs } = buildPrismaMock({
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

      await autoComputeAgentMappings({
        prisma,
        workflowId: "wf-1",
        projectId: "proj-1",
        dsl,
      });

      expect(prisma.agent.update).toHaveBeenCalled();
      const config = updatedConfigs["agent-1"];
      expect(config!["scenarioOutputField"]).toBe("new_out");
      // Input mappings are preserved verbatim.
      const mappings = config!["scenarioMappings"] as Record<string, unknown>;
      expect(mappings["prompt"]).toEqual({
        type: "source",
        sourceId: "scenario",
        path: ["input"],
      });
    });
  });

  describe("when no agents are linked to the workflow", () => {
    it("does not attempt any updates", async () => {
      const dsl = buildDSL({ inputs: ["query"], output: "response" });
      const { prisma } = buildPrismaMock({ agents: [] });

      await autoComputeAgentMappings({
        prisma,
        workflowId: "wf-1",
        projectId: "proj-1",
        dsl,
      });

      expect(prisma.agent.update).not.toHaveBeenCalled();
    });
  });

  describe("when Prisma throws an error", () => {
    it("does not propagate the error (non-blocking)", async () => {
      const dsl = buildDSL({ inputs: ["query"], output: "response" });
      const prisma = {
        agent: {
          findMany: vi.fn().mockRejectedValue(new Error("DB connection lost")),
          update: vi.fn(),
        },
      } as unknown as PrismaClient;

      await expect(
        autoComputeAgentMappings({
          prisma,
          workflowId: "wf-1",
          projectId: "proj-1",
          dsl,
        }),
      ).resolves.toBeUndefined();
    });
  });
});
