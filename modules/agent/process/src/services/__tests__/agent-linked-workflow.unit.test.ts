import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import type { WorkflowApi } from "@langwatch/workflow-contract";
import { describe, expect, it, vi } from "vitest";

import {
  agentWorkflowCopyFixture,
  createAgentAppFixture,
} from "../../app/__tests__/agent.fixture.ts";

async function setup() {
  const copy = vi.fn(async () => agentWorkflowCopyFixture());
  const archiveLinked = vi.fn(async () => ({ id: "workflow_1" }));
  const deleteUncommitted = vi.fn(async () => {});
  const workflows = createApiFixture<WorkflowApi>({
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

  return { ...fixture, copy, archiveLinked, deleteUncommitted };
}

describe("AgentModule linked workflow operations", () => {
  /** @scenario "Linked workflow behaviour is left to the workflow owner" */
  it("copies onto the graph Workflow copied and records the archive for Workflow to cascade", async () => {
    const fixture = await setup();
    const { app } = fixture;

    const copied = await app.createCopy({
      sourceAgentId: "agent_workflow",
      sourceProjectId: "project_1",
      targetProjectId: "project_2",
      workflowId: "workflow_copy",
    });
    expect(fixture.copy).not.toHaveBeenCalled();
    expect(
      await fixture.repositories.agents.getById({ id: copied.id, projectId: "project_2" }),
    ).toMatchObject({ workflowId: "workflow_copy", copiedFromAgentId: "agent_workflow" });

    const archived = await app.cascadeArchive({ id: "agent_workflow", projectId: "project_1" });
    expect(fixture.archiveLinked).not.toHaveBeenCalled();
    expect(fixture.archivedFacts).toMatchObject([
      { agentId: "agent_workflow", projectId: "project_1", cascadedWorkflowId: "workflow_1" },
    ]);
    expect(archived.archivedWorkflow).toEqual({ id: "workflow_1" });
    expect(archived.agent.archivedAt).toBeInstanceOf(Date);
  });
});
