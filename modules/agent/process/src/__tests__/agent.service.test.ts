import { describe, expect, it, vi } from "vitest";
import { createAgentAppFixture } from "../app/__tests__/agent.fixture.ts";

const projectId = "project_1";
const config = {
  prompt: "Answer clearly",
  inputs: [{ identifier: "question", type: "str" as const }],
  outputs: [{ identifier: "answer", type: "str" as const }],
};

describe("AgentApp entity operations", () => {
  /** @scenario "A created agent is validated, persisted and returned resolved" */
  it("validates, persists, and enriches a created agent", async () => {
    const { app, repositories } = createAgentAppFixture();
    const create = vi.spyOn(repositories.agents, "create");
    const agent = await app.create({ projectId, name: "Answerer", type: "signature", config });

    expect(create).toHaveBeenCalledOnce();
    expect(agent).toMatchObject({
      fieldsResolved: true,
      inputFields: config.inputs,
      outputFields: config.outputs,
    });
    expect(agent.id).toMatch(/^agent_/);
    expect(await repositories.agents.getById({ id: agent.id, projectId })).toMatchObject({
      id: agent.id,
      name: "Answerer",
      config,
    });
  });

  /** @scenario "Invalid config is rejected before persistence" */
  it("rejects incompatible config before persistence", async () => {
    const { app, repositories } = createAgentAppFixture();
    const create = vi.spyOn(repositories.agents, "create");

    await expect(
      app.create({
        projectId,
        name: "Broken code",
        type: "code",
        config: { parameters: [] },
      }),
    ).rejects.toMatchObject({ name: "InvalidAgentConfigError", agentType: "code" });
    expect(create).not.toHaveBeenCalled();
    expect(await repositories.agents.findAll({ projectId })).toEqual([]);
  });

  it("checks active references in the requested project", async () => {
    const { app } = createAgentAppFixture();
    const created = await app.create({ projectId, name: "Answerer", type: "signature", config });

    expect(await app.exists({ id: created.id, projectId })).toBe(true);
    expect(await app.exists({ id: created.id, projectId: "other" })).toBe(false);
    await app.archive({ id: created.id, projectId });
    expect(await app.exists({ id: created.id, projectId })).toBe(false);
  });

  /** @scenario "A missing singular agent read throws" */
  it("throws a concrete error carrying both identifiers when absent", async () => {
    const { app } = createAgentAppFixture();

    await expect(app.getById({ id: "agent_missing", projectId })).rejects.toMatchObject({
      name: "AgentNotFoundError",
      agentId: "agent_missing",
      projectId,
    });
  });

  /** @scenario "Invalid config is rejected before persistence" */
  it("does not persist a type-only update with incompatible config", async () => {
    const { app, repositories } = createAgentAppFixture();
    const created = await app.create({ projectId, name: "Answerer", type: "signature", config });
    const before = await repositories.agents.getById({ id: created.id, projectId });
    const update = vi.spyOn(repositories.agents, "update");

    await expect(app.update({ id: created.id, projectId, type: "code" })).rejects.toMatchObject({
      name: "InvalidAgentConfigError",
      agentType: "code",
    });
    expect(update).not.toHaveBeenCalled();
    expect(await repositories.agents.getById({ id: created.id, projectId })).toEqual(before);
  });
});
