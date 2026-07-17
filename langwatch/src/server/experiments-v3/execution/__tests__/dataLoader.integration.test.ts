/**
 * Integration tests for loadExecutionData against the real database.
 *
 * Regression coverage for: a workflow built in Optimization Studio and saved
 * as an agent (agent.type === "workflow") has no code of its own — it only
 * points at a Studio workflow. loadExecutionData must resolve that linked
 * workflow's published DSL so the orchestrator can run it as a whole
 * workflow, instead of falling through to the code-execution path with no
 * source at all (see workflowBuilder.ts's buildTargetNode).
 */
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AgentService } from "~/server/agents/agent.service";
import { prisma } from "~/server/db";
import { getTestProject, getTestUser } from "~/utils/testUtils";
import { loadExecutionData, workflowLoadKey } from "../dataLoader";

describe("loadExecutionData", () => {
  let projectId: string;
  let authorId: string;
  const cleanupAgentIds: string[] = [];
  const cleanupWorkflowIds: string[] = [];

  beforeAll(async () => {
    const project = await getTestProject("data-loader");
    projectId = project.id;
    const user = await getTestUser();
    authorId = user.id;
  });

  afterAll(async () => {
    for (const id of cleanupAgentIds) {
      await prisma.agent.deleteMany({ where: { id, projectId } });
    }
    for (const id of cleanupWorkflowIds) {
      await prisma.workflowVersion.deleteMany({
        where: { workflowId: id, projectId },
      });
      await prisma.workflow.deleteMany({ where: { id, projectId } });
    }
  });

  const createPublishedWorkflow = async (name: string) => {
    const workflowId = `test_wf_${nanoid(8)}`;
    await prisma.workflow.create({
      data: {
        id: workflowId,
        projectId,
        name,
        icon: "🤖",
        description: "Test workflow",
      },
    });
    cleanupWorkflowIds.push(workflowId);

    const version = await prisma.workflowVersion.create({
      data: {
        id: `test_wfv_${nanoid(8)}`,
        workflowId,
        projectId,
        version: "1",
        commitMessage: "initial",
        authorId,
        dsl: {
          nodes: [
            { id: "entry", type: "entry", data: {} },
            { id: "llm", type: "signature", data: {} },
            { id: "end", type: "end", data: {} },
          ],
          edges: [],
        },
      },
    });

    await prisma.workflow.update({
      where: { id: workflowId },
      data: { publishedId: version.id },
    });

    return { workflowId, versionId: version.id };
  };

  describe("given an agent target that wraps a Studio workflow", () => {
    it("resolves the linked workflow's published DSL", async () => {
      const { workflowId, versionId } = await createPublishedWorkflow(
        "fast resolution agent workflow",
      );

      const agentService = AgentService.create(prisma);
      const agent = await agentService.create({
        id: `test_agent_${nanoid(8)}`,
        projectId,
        name: "fast resolution agent",
        type: "workflow",
        config: { name: "Custom", workflow_id: workflowId },
        workflowId,
      });
      cleanupAgentIds.push(agent.id);

      const result = await loadExecutionData(
        projectId,
        { type: "inline", columns: [], inline: { columns: [], records: {} } },
        [{ type: "agent", dbAgentId: agent.id }],
        [],
      );

      if ("error" in result) {
        throw new Error(`loadExecutionData failed: ${result.error}`);
      }

      const loadedWorkflow = result.loadedWorkflows.get(
        workflowLoadKey({ workflowId }),
      );
      expect(loadedWorkflow).toBeDefined();
      expect(loadedWorkflow?.id).toBe(workflowId);
      expect(loadedWorkflow?.versionId).toBe(versionId);
      expect(loadedWorkflow?.dsl.nodes).toHaveLength(3);

      // The agent itself is still loaded too (name/type used for display and
      // for the orchestrator to detect agent.type === "workflow").
      const loadedAgent = result.loadedAgents.get(agent.id);
      expect(loadedAgent?.type).toBe("workflow");
    });

    it("errors clearly when the linked workflow has no published version", async () => {
      const workflowId = `test_wf_${nanoid(8)}`;
      await prisma.workflow.create({
        data: {
          id: workflowId,
          projectId,
          name: "unpublished workflow",
          icon: "🤖",
          description: "Test workflow with no published version",
        },
      });
      cleanupWorkflowIds.push(workflowId);

      const agentService = AgentService.create(prisma);
      const agent = await agentService.create({
        id: `test_agent_${nanoid(8)}`,
        projectId,
        name: "unpublished workflow agent",
        type: "workflow",
        config: { name: "Custom", workflow_id: workflowId },
        workflowId,
      });
      cleanupAgentIds.push(agent.id);

      const result = await loadExecutionData(
        projectId,
        { type: "inline", columns: [], inline: { columns: [], records: {} } },
        [{ type: "agent", dbAgentId: agent.id }],
        [],
      );

      expect("error" in result).toBe(true);
      if ("error" in result) {
        expect(result.error).toContain("no committed version");
      }
    });
  });
});
