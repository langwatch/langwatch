/**
 * Every write to an agent records that it changed, so its reads go stale in every open tab.
 * Spec: modules/agent/specs/agent-versioning.feature
 */
import { createTenantId } from "@langwatch/eventing";
import { Temporal } from "@langwatch/time";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  contextOf,
  lanesOf,
  versionSavedEvent,
} from "../../eventing/__tests__/agent-workflow-fields.fixture.ts";
import {
  RecordAgentChangedCommand,
  type RecordAgentChangedCommandData,
} from "../../eventing/agent-lifecycle.commands.ts";
import { createAgentAppFixture } from "./agent.fixture.ts";

const reference = { id: "agent_1", projectId: "project_1" };
const ada = { type: "user", id: "user_ada" } as const;

async function httpAgent() {
  const fixture = createAgentAppFixture();
  await fixture.app.create({
    ...reference,
    name: "Support bot",
    type: "http",
    config: { name: "Support bot", url: "https://old.example.test/chat", method: "POST" },
    caller: ada,
  });
  return fixture;
}

const written = (facts: { agentId: string; projectId: string; tenantId: string }[]) =>
  facts.map(({ agentId, projectId, tenantId }) => ({ agentId, projectId, tenantId }));

describe("the agent changed fact", () => {
  /** @scenario "Every write to an agent records that it changed" */
  it("is recorded in the agent's own project when its URL changes", async () => {
    const { app, changedFacts } = await httpAgent();
    changedFacts.length = 0;

    await app.update({
      ...reference,
      config: { name: "Support bot", url: "https://new.example.test/chat", method: "POST" },
      caller: ada,
    });

    expect(written(changedFacts)).toEqual([
      { agentId: "agent_1", projectId: "project_1", tenantId: "project_1" },
    ]);
  });

  /** @scenario "Every write to an agent records that it changed" */
  it("is recorded on create, on each label move and on a copy, push and sync", async () => {
    const { app, changedFacts } = await httpAgent();
    expect(written(changedFacts)).toHaveLength(1);

    await app.assignLabel({
      projectId: "project_1",
      agentId: "agent_1",
      label: "staging",
      version: 1,
    });
    await app.removeLabel({ projectId: "project_1", agentId: "agent_1", label: "staging" });
    const copy = await app.createCopy({
      sourceAgentId: "agent_1",
      sourceProjectId: "project_1",
      targetProjectId: "project_2",
    });
    await app.pushToCopies({ sourceAgentId: "agent_1", sourceProjectId: "project_1" });
    await app.syncFromSource({ agentId: copy.id, projectId: "project_2" });

    expect(written(changedFacts).map(({ agentId, projectId }) => [agentId, projectId])).toEqual([
      ["agent_1", "project_1"],
      ["agent_1", "project_1"],
      ["agent_1", "project_1"],
      [copy.id, "project_2"],
      ["agent_1", "project_1"],
      [copy.id, "project_2"],
      ["agent_1", "project_1"],
      [copy.id, "project_2"],
      ["agent_1", "project_1"],
    ]);
  });

  /** @scenario "Every write to an agent records that it changed" */
  it("is recorded for each linked agent a workflow's new fields are written into", async () => {
    const { app, changedFacts } = createAgentAppFixture();
    await app.create({
      id: "agent_workflow",
      projectId: "project_1",
      name: "Workflow agent",
      type: "workflow",
      config: { workflow_id: "workflow_1" },
      workflowId: "workflow_1",
    });
    changedFacts.length = 0;
    const lanes = lanesOf(app.workflowFieldsPipeline());
    const event = versionSavedEvent({
      fields: { inputFields: [], outputFields: [], fieldsResolved: true },
    });

    await lanes.versionSaved.handle(event, contextOf(event));

    expect(written(changedFacts)).toEqual([
      { agentId: "agent_workflow", projectId: "project_1", tenantId: "project_1" },
    ]);
  });

  /** @scenario "Every write to an agent records that it changed" */
  it("is recorded on a push for the copies it wrote and for the source", async () => {
    const { app, changedFacts } = await httpAgent();
    const kept = await app.createCopy({
      sourceAgentId: "agent_1",
      sourceProjectId: "project_1",
      targetProjectId: "project_2",
    });
    await app.createCopy({
      sourceAgentId: "agent_1",
      sourceProjectId: "project_1",
      targetProjectId: "project_3",
    });
    changedFacts.length = 0;

    await app.pushToCopies({
      sourceAgentId: "agent_1",
      sourceProjectId: "project_1",
      copyIds: [kept.id],
    });

    expect(written(changedFacts)).toEqual([
      { agentId: kept.id, projectId: "project_2", tenantId: "project_2" },
      { agentId: "agent_1", projectId: "project_1", tenantId: "project_1" },
    ]);
  });
});

describe("two writes in the same millisecond", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  const keyOf = (fact: RecordAgentChangedCommandData) => {
    const [event] = new RecordAgentChangedCommand().handle({
      tenantId: createTenantId(fact.tenantId),
      aggregateId: fact.agentId,
      type: "record",
      data: fact,
    });
    return event?.idempotencyKey;
  };

  /** @scenario "Two writes to an agent in the same millisecond stay two changed facts" */
  it("key two facts apart and a redelivered one alike", async () => {
    const { app, changedFacts } = await httpAgent();
    changedFacts.length = 0;
    const frozen = Temporal.Instant.fromEpochMilliseconds(1_790_000_000_000);
    vi.spyOn(Temporal.Now, "instant").mockReturnValue(frozen);
    for (const url of ["https://a.example.test/chat", "https://b.example.test/chat"]) {
      await app.update({
        ...reference,
        config: { name: "Support bot", url, method: "POST" },
        caller: ada,
      });
    }
    const [first, second] = changedFacts;
    if (!first || !second) throw new Error("two writes recorded fewer than two facts");

    expect([first.occurredAt, second.occurredAt]).toEqual([
      frozen.epochMilliseconds,
      frozen.epochMilliseconds,
    ]);
    expect(keyOf(first)).not.toBe(keyOf(second));
    expect(keyOf({ ...first })).toBe(keyOf(first));
  });
});

describe("when the agent changed fact cannot be sent", () => {
  /** @scenario "A committed agent write still succeeds when its changed fact cannot be recorded" */
  it("still saves and returns the change", async () => {
    const { app } = await httpAgent();
    const failing = {
      send: async () => {
        throw new Error("queue unavailable");
      },
      sendBatch: async () => {},
      close: async () => {},
      waitUntilReady: async () => {},
    };
    app.connectLifecycleCommands({ recordAgentArchived: failing, recordAgentChanged: failing });
    const url = "https://new.example.test/chat";

    const updated = await app.update({
      ...reference,
      config: { name: "Support bot", url, method: "POST" },
      caller: ada,
    });

    expect(updated.config).toMatchObject({ url });
  });
});
