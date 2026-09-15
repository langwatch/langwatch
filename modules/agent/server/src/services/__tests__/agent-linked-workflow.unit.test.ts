import { describe, expect, it, vi } from "vitest";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import type { WorkflowApi } from "@langwatch/workflow-contract";
import { agentWorkflowCopyFixture, createAgentAppFixture } from "../../app/__tests__/agent.fixture.ts";

async function setup() {
  const listSummaries = vi.fn(async () => [{ id: "workflow_1", name: "Linked workflow" }]);
  const copy = vi.fn(async () => agentWorkflowCopyFixture());
  const archiveLinked = vi.fn(async () => ({ id: "workflow_1" }));
  const deleteUncommitted = vi.fn(async () => {});
  const workflows = createApiFixture<WorkflowApi>({
    listSummaries,
    copy,
    archiveLinked,
    deleteUncommitted,
  });
  const fixture = createAgentAppFixture({ workflows });
  await fixture.repositories.agents.create({
    id: "agent_workflow",
    projectId: "project_1",
    name: "Studio agent",
    type: "workflow",
    config: { workflow_id: "workflow_1" },
    workflowId: "workflow_1",
  });

  return { ...fixture, listSummaries, copy, archiveLinked, deleteUncommitted };
}

describe("AgentApp linked workflow operations", () => {
  /** @scenario "Linked workflow behaviour uses the injected Workflow API" */
  it("reads, copies and archives through the Workflow API", async () => {
    const fixture = await setup();
    const { app } = fixture;

    expect(await app.relatedEntities({ id: "agent_workflow", projectId: "project_1" })).toEqual({
      workflow: { id: "workflow_1", name: "Linked workflow" },
    });
    expect(fixture.listSummaries).toHaveBeenCalledWith({
      projectId: "project_1",
      workflowIds: ["workflow_1"],
    });

    const copied = await app.copy({
      sourceAgentId: "agent_workflow",
      sourceProjectId: "project_1",
      targetProjectId: "project_2",
      actorUserId: "user_1",
    });
    expect(fixture.copy).toHaveBeenCalledWith(
      {
        sourceWorkflowId: "workflow_1",
        sourceProjectId: "project_1",
        targetProjectId: "project_2",
        copiedFromWorkflowId: "workflow_1",
        authorId: "user_1",
      },
      { id: "user_1" },
    );
    expect(
      await fixture.repositories.agents.getById({ id: copied.id, projectId: "project_2" }),
    ).toMatchObject({ workflowId: "workflow_copy", copiedFromAgentId: "agent_workflow" });

    const archived = await app.cascadeArchive({ id: "agent_workflow", projectId: "project_1" });
    expect(fixture.archiveLinked).toHaveBeenCalledWith({
      workflowId: "workflow_1",
      projectId: "project_1",
    });
    expect(archived.archivedWorkflow).toEqual({ id: "workflow_1" });
    expect(archived.agent.archivedAt).toBeInstanceOf(Date);
  });

  it("removes the copied workflow when persisting its Agent fails", async () => {
    const fixture = await setup();
    const failure = new Error("write refused");
    vi.spyOn(fixture.repositories.agents, "create").mockRejectedValueOnce(failure);

    await expect(
      fixture.app.copy({
        sourceAgentId: "agent_workflow",
        sourceProjectId: "project_1",
        targetProjectId: "project_2",
        actorUserId: "user_1",
      }),
    ).rejects.toBe(failure);
    expect(fixture.deleteUncommitted).toHaveBeenCalledWith({
      workflowId: "workflow_copy",
      projectId: "project_2",
    });
    expect(await fixture.repositories.agents.findAll({ projectId: "project_2" })).toEqual([]);
  });
});
