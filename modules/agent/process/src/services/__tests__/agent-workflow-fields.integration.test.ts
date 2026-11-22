/**
 * A workflow agent's fields come from workflow's facts, stored in agent's own config.
 * Spec: modules/agent/specs/linked-workflow-and-history.feature
 */
import type { WorkflowMappingFields } from "@langwatch/workflow-contract";
import { describe, expect, it } from "vitest";

import { createAgentAppFixture } from "../../app/__tests__/agent.fixture.ts";
import {
  archivedEvent,
  contextOf,
  lanesOf,
  versionSavedEvent,
} from "../../eventing/__tests__/agent-workflow-fields.fixture.ts";

const FIELDS: WorkflowMappingFields = {
  inputFields: [{ identifier: "question", type: "str" }],
  outputFields: [
    { identifier: "output", type: "str" },
    { identifier: "chunks", type: "dict" },
  ],
  fieldsResolved: true,
};

async function setup() {
  const fixture = createAgentAppFixture();
  const agent = await fixture.app.create({
    id: "agent_workflow",
    projectId: "project_1",
    name: "Workflow agent",
    type: "workflow",
    config: { workflow_id: "workflow_1" },
    workflowId: "workflow_1",
  });
  const lanes = lanesOf(fixture.app.workflowFieldsPipeline());
  const saved = async (data: Parameters<typeof versionSavedEvent>[0]) => {
    const event = versionSavedEvent(data);
    await lanes.versionSaved.handle(event, contextOf(event));
  };
  await saved({ fields: FIELDS });

  return { ...fixture, agent, lanes, saved };
}

describe("AgentModule workflow field enrichment", () => {
  /** @scenario "A workflow agent reports the end node's results as its output fields" */
  it("returns all declared outputs and preserves their object type", async () => {
    const { app, agent } = await setup();

    expect((await app.getById(agent)).outputFields).toEqual([
      { identifier: "output", type: "str" },
      { identifier: "chunks", type: "dict" },
    ]);
  });

  /** @scenario "A workflow agent reports the entry node's fields as its input fields" */
  it("returns the entry inputs workflow recorded", async () => {
    const { app, agent } = await setup();

    expect((await app.getById(agent)).inputFields).toEqual([
      { identifier: "question", type: "str" },
    ]);
  });

  it("returns the same resolved fields in the project list", async () => {
    const { app, agent } = await setup();
    const listed = await app.getAll({ projectId: agent.projectId });

    expect(listed).toHaveLength(1);
    expect(listed[0]?.outputFields).toEqual(FIELDS.outputFields);
    expect(listed[0]?.fieldsResolved).toBe(true);
  });

  /** @scenario "Workflow fields describe the current graph" */
  /** @scenario "Editing the workflow changes the agent's fields without touching the agent" */
  it("takes a newer version's fields and leaves the agent's own settings alone", async () => {
    const { app, agent, saved, repositories } = await setup();
    const before = await repositories.agents.getById(agent);

    await saved({
      versionId: "version_2",
      occurredAt: 1_500,
      fields: {
        ...FIELDS,
        outputFields: [...FIELDS.outputFields, { identifier: "citations", type: "list" }],
      },
    });
    const read = await app.getById(agent);

    expect(read.outputFields.map((field) => field.identifier)).toEqual([
      "output",
      "chunks",
      "citations",
    ]);
    expect(read.name).toBe(before.name);
    expect(read.workflowId).toBe("workflow_1");
  });

  /** @scenario "A workflow agent whose workflow declares no results reports none" */
  it("preserves a resolved workflow with no outputs", async () => {
    const { app, agent, saved } = await setup();
    await saved({ occurredAt: 1_500, fields: { ...FIELDS, outputFields: [] } });

    expect(await app.getById(agent)).toMatchObject({ outputFields: [], fieldsResolved: true });
  });

  /** @scenario "Workflow fields describe the current graph" */
  /** @scenario "A workflow agent whose workflow was deleted reports no fields" */
  it("returns unresolved fields once workflow records the graph archived", async () => {
    const { app, agent, lanes } = await setup();
    const event = archivedEvent({});
    await lanes.archived.handle(event, contextOf(event));

    expect(await app.getById(agent)).toMatchObject({
      id: agent.id,
      inputFields: [],
      outputFields: [],
      fieldsResolved: false,
    });
  });

  /** @scenario "Workflow fields describe the current graph" */
  /** @scenario "A workflow agent pointing at no workflow at all reports no fields" */
  it("keeps an agent no workflow fact names, and ignores another project's graph", async () => {
    const { app, saved } = await setup();
    const agent = await app.create({
      id: "agent_orphan",
      projectId: "project_1",
      name: "Orphan",
      type: "workflow",
      config: { workflow_id: "missing" },
      workflowId: "missing",
    });
    await saved({
      projectId: "project_2",
      workflowId: "missing",
      occurredAt: 1_500,
      fields: FIELDS,
    });

    expect(await app.getById(agent)).toMatchObject({
      id: agent.id,
      inputFields: [],
      outputFields: [],
      fieldsResolved: false,
    });
  });

  /** @scenario "Editing a workflow agent keeps the fields workflow recorded" */
  it("keeps the recorded fields when the agent is edited, and drops them when it is re-pointed", async () => {
    const { app, agent } = await setup();

    const renamed = await app.update({
      id: agent.id,
      projectId: agent.projectId,
      name: "Renamed",
      type: "workflow",
      config: { workflow_id: "workflow_1" },
    });
    expect(renamed).toMatchObject({ fieldsResolved: true, inputFields: FIELDS.inputFields });

    const repointed = await app.update({
      id: agent.id,
      projectId: agent.projectId,
      type: "workflow",
      config: { workflow_id: "workflow_2" },
      workflowId: "workflow_2",
    });
    expect(repointed).toMatchObject({ fieldsResolved: false, inputFields: [] });
  });
});
