/**
 * @vitest-environment node
 * @unit
 * @see modules/agent/specs/linked-workflow-and-history.feature
 */
import { WORKFLOW_VERSION_SAVED_EVENT_TYPE } from "@langwatch/workflow-contract";
import { describe, expect, it, vi } from "vitest";

import { createAgentAppFixture } from "../../app/__tests__/agent.fixture.ts";
import {
  archivedEvent,
  contextOf,
  deduplicationIdOf,
  lanesOf,
  versionSavedEvent,
} from "./agent-workflow-fields.fixture.ts";

const FIELDS = {
  inputFields: [{ identifier: "question", type: "str" as const }],
  outputFields: [{ identifier: "answer", type: "str" as const }],
  fieldsResolved: true,
};

async function setup() {
  const fixture = createAgentAppFixture();
  await fixture.repositories.agents.create({
    id: "agent_1",
    projectId: "project_1",
    name: "Linked",
    type: "workflow",
    config: { workflow_id: "workflow_1" },
    workflowId: "workflow_1",
  });
  const writes = vi.spyOn(fixture.repositories.agents, "updateWorkflowConfig");
  const lanes = lanesOf(fixture.app.workflowFieldsPipeline());
  const read = () => fixture.app.getById({ id: "agent_1", projectId: "project_1" });
  return { ...fixture, writes, lanes, read };
}

describe("agent's workflow fields peer lanes", () => {
  describe("when the same version fact is redelivered", () => {
    /** @scenario "A redelivered workflow version fact writes the fields once" */
    it("keys both deliveries alike and writes the agent's config once", async () => {
      const { lanes, writes, read } = await setup();
      const event = versionSavedEvent({ fields: FIELDS });
      const redelivered = versionSavedEvent({ id: "redelivered", fields: FIELDS });

      await lanes.versionSaved.handle(event, contextOf(event));
      await lanes.versionSaved.handle(redelivered, contextOf(redelivered));

      expect(lanes.versionSaved.eventTypes).toEqual([WORKFLOW_VERSION_SAVED_EVENT_TYPE]);
      expect(writes).toHaveBeenCalledTimes(1);
      expect(deduplicationIdOf({ definition: lanes.versionSaved, event })).toBe(
        deduplicationIdOf({ definition: lanes.versionSaved, event: redelivered }),
      );
      expect(await read()).toMatchObject({ fieldsResolved: true, inputFields: FIELDS.inputFields });
    });
  });

  describe("when a fact older than the stored fields arrives", () => {
    /** @scenario "A workflow fact older than the stored fields changes nothing" */
    it("leaves the newer fields in place", async () => {
      const { lanes, writes, read } = await setup();
      const newer = versionSavedEvent({ occurredAt: 3_000, fields: FIELDS });
      const olderArchive = archivedEvent({ occurredAt: 2_000 });

      await lanes.versionSaved.handle(newer, contextOf(newer));
      await lanes.archived.handle(olderArchive, contextOf(olderArchive));

      expect(writes).toHaveBeenCalledTimes(1);
      expect(await read()).toMatchObject({ fieldsResolved: true });
    });
  });

  describe("when a version fact carries no fields", () => {
    it("writes nothing", async () => {
      const { lanes, writes } = await setup();
      const event = versionSavedEvent({});

      await lanes.versionSaved.handle(event, contextOf(event));

      expect(writes).not.toHaveBeenCalled();
    });
  });
});
