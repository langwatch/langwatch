import { describe, expect, it, vi } from "vitest";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import type { WorkflowApi, WorkflowMappingFields } from "@langwatch/workflow-contract";
import { createAgentAppFixture } from "../../app/__tests__/agent.fixture.ts";

async function setup() {
  const fields: Record<string, WorkflowMappingFields> = {
    workflow_1: {
      inputFields: [{ identifier: "question", type: "str" }],
      outputFields: [
        { identifier: "output", type: "str" },
        { identifier: "chunks", type: "dict" },
      ],
      fieldsResolved: true,
    },
  };
  const listFields = vi.fn(async () => fields);
  const fixture = createAgentAppFixture({
    workflows: createApiFixture<WorkflowApi>({ listFields }),
  });
  const agent = await fixture.app.create({
    id: "agent_workflow",
    projectId: "project_1",
    name: "Workflow agent",
    type: "workflow",
    config: { workflow_id: "workflow_1" },
    workflowId: "workflow_1",
  });

  return { ...fixture, agent, fields, listFields };
}

describe("AgentApp workflow field enrichment", () => {
  it("returns all declared outputs and preserves their object type", async () => {
    const { app, agent, listFields } = await setup();
    const read = await app.getById(agent);

    expect(read.outputFields).toEqual([
      { identifier: "output", type: "str" },
      { identifier: "chunks", type: "dict" },
    ]);
    expect(listFields).toHaveBeenLastCalledWith({
      projectId: "project_1",
      workflowIds: ["workflow_1"],
    });
  });

  it("returns entry inputs from the Workflow API", async () => {
    const { app, agent } = await setup();

    expect((await app.getById(agent)).inputFields).toEqual([
      { identifier: "question", type: "str" },
    ]);
  });

  it("returns the same resolved fields in the project list", async () => {
    const { app, agent } = await setup();
    const listed = await app.getAll({ projectId: agent.projectId });

    expect(listed).toHaveLength(1);
    expect(listed[0]?.outputFields).toEqual(agent.outputFields);
    expect(listed[0]?.fieldsResolved).toBe(true);
  });

  /** @scenario "Workflow fields describe the current graph" */
  it("refreshes fields without modifying the persisted Agent", async () => {
    const { app, agent, fields, repositories } = await setup();
    const before = await repositories.agents.getById(agent);
    fields.workflow_1 = {
      inputFields: agent.inputFields,
      outputFields: [...agent.outputFields, { identifier: "citations", type: "list" }],
      fieldsResolved: true,
    };

    const read = await app.getById(agent);

    expect(read.outputFields.map((field) => field.identifier)).toEqual([
      "output",
      "chunks",
      "citations",
    ]);
    expect(read.updatedAt).toEqual(before.updatedAt);
    expect(await repositories.agents.getById(agent)).toEqual(before);
  });

  it("preserves a resolved workflow with no outputs", async () => {
    const { app, agent, fields } = await setup();
    fields.workflow_1 = { inputFields: agent.inputFields, outputFields: [], fieldsResolved: true };

    expect(await app.getById(agent)).toMatchObject({ outputFields: [], fieldsResolved: true });
  });

  /** @scenario "Workflow fields describe the current graph" */
  it("returns unresolved fields when the Workflow API excludes an archived graph", async () => {
    const { app, agent, fields } = await setup();
    delete fields.workflow_1;

    expect(await app.getById(agent)).toMatchObject({
      id: agent.id,
      inputFields: [],
      outputFields: [],
      fieldsResolved: false,
    });
  });

  /** @scenario "Workflow fields describe the current graph" */
  it("keeps an agent whose workflow cannot be resolved in the project", async () => {
    const { app } = createAgentAppFixture({
      workflows: createApiFixture<WorkflowApi>({ listFields: async () => ({}) }),
    });
    const agent = await app.create({
      id: "agent_orphan",
      projectId: "project_1",
      name: "Orphan",
      type: "workflow",
      config: { workflow_id: "missing" },
      workflowId: "missing",
    });

    expect(await app.getById(agent)).toMatchObject({
      id: agent.id,
      inputFields: [],
      outputFields: [],
      fieldsResolved: false,
    });
  });
});
