import { describe, expect, it } from "vitest";
import { createAgentAppFixture } from "../../app/__tests__/agent.fixture.ts";

describe("copying a connected agent", () => {
  it("refuses the copy and persists no row", async () => {
    const { app, repositories } = createAgentAppFixture();
    const registered = await app.registerConnected({
      id: "agent_connected",
      projectId: "project_1",
      name: "support",
      config: { parameters: [], sdk: { name: "langwatch", version: "1", language: "python" } },
      identity: {
        environment: "production",
        ownerUserId: null,
        hostLabel: null,
        identityKey: "support@production",
      },
    });

    await expect(
      app.copy({
        sourceAgentId: registered.id,
        sourceProjectId: registered.projectId,
        targetProjectId: "project_2",
        actorUserId: "user_1",
        newAgentId: "agent_copy",
      }),
    ).rejects.toMatchObject({ code: "agent_register_only" });
    expect(await repositories.agents.findCopies(registered.id)).toEqual([]);
    expect(await repositories.agents.findAll({ projectId: "project_2" })).toEqual([]);
    expect(
      await repositories.agents.getById({ id: registered.id, projectId: registered.projectId }),
    ).toEqual(registered);
  });
});
