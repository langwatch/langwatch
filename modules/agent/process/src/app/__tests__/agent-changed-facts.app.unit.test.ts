/**
 * Every write to an agent records that it changed, so its reads go stale in every open tab.
 * Spec: modules/agent/specs/agent-versioning.feature
 */
import { describe, expect, it } from "vitest";

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
      [copy.id, "project_2"],
      [copy.id, "project_2"],
    ]);
  });
});
