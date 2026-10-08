/**
 * Copying an agent: workflow copies a workflow agent's graph, agent writes the row.
 * Spec: modules/workflow/specs/workflow-service.feature.
 */
import type { AgentApi, AgentOverview, CopyAgentCommand } from "@langwatch/agent-contract";
import { createTestLogger } from "@langwatch/test-harness";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import type { CopyWorkflowCommand, WorkflowWithVersion } from "@langwatch/workflow-contract";
import { describe, expect, it } from "vitest";

import {
  WorkflowAgentCopyService,
  type WorkflowAgentCopyServiceOptions,
} from "../workflow-agent-copy.service.ts";

type Graphs = WorkflowAgentCopyServiceOptions["workflows"];

const request = {
  agentId: "agent_source",
  projectId: "project_target",
  sourceProjectId: "project_source",
  newAgentId: "agent_copy",
};

function agent(overrides: Partial<AgentOverview>): AgentOverview {
  return {
    id: "agent_source",
    projectId: "project_source",
    name: "Studio agent",
    type: "workflow",
    config: { workflow_id: "workflow_source" },
    workflowId: "workflow_source",
    ...overrides,
  } as AgentOverview;
}

/** The graph copies the service asks for, answered with `workflow_copy`. */
class RecordingGraphs implements Graphs {
  readonly copies: CopyWorkflowCommand[] = [];
  readonly deleted: { workflowId: string; projectId: string }[] = [];

  constructor(private readonly refuseDelete?: Error) {}

  async copy(input: CopyWorkflowCommand) {
    this.copies.push(input);
    return {
      workflow: { id: "workflow_copy" } as WorkflowWithVersion,
      version: {},
    } as Awaited<ReturnType<Graphs["copy"]>>;
  }

  async deleteUncommitted(input: { workflowId: string; projectId: string }) {
    this.deleted.push(input);
    if (this.refuseDelete) throw this.refuseDelete;
  }
}

function setup({
  source = agent({}),
  permitted = true,
  refuseWrite,
  refuseDelete,
}: {
  source?: AgentOverview;
  permitted?: boolean;
  refuseWrite?: Error;
  refuseDelete?: Error;
} = {}) {
  const reads: string[] = [];
  const writes: CopyAgentCommand[] = [];
  const graphs = new RecordingGraphs(refuseDelete);
  const { logger, lines } = createTestLogger();
  const agents = createApiFixture<AgentApi>({
    getById: async (input) => {
      reads.push(input.id);
      return source;
    },
    createCopy: async (input) => {
      writes.push(input);
      if (refuseWrite) throw refuseWrite;
      return {
        id: input.newAgentId ?? "agent_new",
        projectId: input.targetProjectId,
        name: source.name,
        copiedFromAgentId: source.id,
      };
    },
  });
  const service = WorkflowAgentCopyService.create({
    agents,
    permissions: { has: async () => permitted },
    workflows: graphs,
    logger,
  });

  return { service, reads, writes, graphs, lines };
}

describe("WorkflowAgentCopyService", () => {
  describe("when the source agent runs a workflow", () => {
    /** @scenario "Copying a workflow agent copies its graph first" */
    it("copies the graph as the caller, then has Agent write the copy pointing at it", async () => {
      const { service, writes, graphs } = setup();

      await expect(service.copyAgent(request, { id: "user_1" })).resolves.toEqual({
        id: "agent_copy",
        projectId: "project_target",
        name: "Studio agent",
        copiedFromAgentId: "agent_source",
      });
      expect(graphs.copies).toEqual([
        {
          sourceWorkflowId: "workflow_source",
          sourceProjectId: "project_source",
          targetProjectId: "project_target",
          copiedFromWorkflowId: "workflow_source",
          authorId: "user_1",
        },
      ]);
      expect(writes).toEqual([
        {
          sourceAgentId: "agent_source",
          sourceProjectId: "project_source",
          targetProjectId: "project_target",
          newAgentId: "agent_copy",
          workflowId: "workflow_copy",
        },
      ]);
      expect(graphs.deleted).toEqual([]);
    });
  });

  describe("when the source agent has no graph", () => {
    /** @scenario "Copying an agent with no graph asks Agent alone" */
    it("copies no graph and writes the copy with none", async () => {
      const { service, writes, graphs } = setup({
        source: agent({ type: "signature", config: {}, workflowId: null }),
      });

      await service.copyAgent(request, { id: "user_1" });

      expect(graphs.copies).toEqual([]);
      expect(writes).toMatchObject([{ sourceAgentId: "agent_source", workflowId: undefined }]);
    });
  });

  describe("when the caller cannot manage the source project", () => {
    /** @scenario "Copying an agent from a project the caller cannot manage is refused" */
    it("refuses before reading the agent and copies nothing", async () => {
      const { service, reads, writes, graphs } = setup({ permitted: false });

      await expect(service.copyAgent(request, { id: "user_1" })).rejects.toMatchObject({
        code: "agent_source_permission_denied",
      });
      expect(reads).toEqual([]);
      expect(graphs.copies).toEqual([]);
      expect(writes).toEqual([]);
    });
  });

  describe("when Agent refuses to write the copy", () => {
    /** @scenario "A failed agent write removes the copied graph" */
    it("deletes the uncommitted graph copy and rethrows the original failure", async () => {
      const failure = new Error("agent row rejected");
      const { service, graphs } = setup({ refuseWrite: failure });

      await expect(service.copyAgent(request, { id: "user_1" })).rejects.toBe(failure);
      expect(graphs.deleted).toEqual([
        { workflowId: "workflow_copy", projectId: "project_target" },
      ]);
    });

    /** @scenario "A failed agent write removes the copied graph" */
    it("logs a failed removal without replacing the original failure", async () => {
      const failure = new Error("agent row rejected");
      const { service, lines } = setup({
        refuseWrite: failure,
        refuseDelete: new Error("workflow cleanup refused"),
      });

      await expect(service.copyAgent(request, { id: "user_1" })).rejects.toBe(failure);
      expect(lines.findLine("error", "Failed to remove uncommitted workflow copy")).toMatchObject({
        workflowId: "workflow_copy",
      });
    });
  });
});
