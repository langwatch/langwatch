import { describe, expect, it } from "vitest";

import { createAgentAppFixture } from "../../app/__tests__/agent.fixture.ts";

async function setup() {
  const fixture = createAgentAppFixture();
  await fixture.repositories.agents.create({
    id: "agent_workflow",
    projectId: "project_1",
    name: "Studio agent",
    type: "workflow",
    config: { workflow_id: "workflow_1" },
    workflowId: "workflow_1",
  });

  return fixture;
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
    expect(
      await fixture.repositories.agents.getById({ id: copied.id, projectId: "project_2" }),
    ).toMatchObject({ workflowId: "workflow_copy", copiedFromAgentId: "agent_workflow" });

    const archived = await app.cascadeArchive({ id: "agent_workflow", projectId: "project_1" });
    expect(fixture.archivedFacts).toMatchObject([
      { agentId: "agent_workflow", projectId: "project_1", cascadedWorkflowId: "workflow_1" },
    ]);
    expect(archived.archivedWorkflow).toEqual({ id: "workflow_1" });
    expect(archived.agent.archivedAt).toBeInstanceOf(Date);
  });
});
