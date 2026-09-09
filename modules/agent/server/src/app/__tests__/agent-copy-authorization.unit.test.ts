import { AgentSourcePermissionDeniedError } from "@langwatch/agent-contract";
import type { AuthzApi } from "@langwatch/authz-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { describe, expect, it, vi } from "vitest";
import { createAgentAppFixture } from "../../testing.ts";

async function fixture() {
  const hasProjectPermission = vi.fn(
    async (input: { projectId: string }) => input.projectId === "target",
  );
  const appFixture = createAgentAppFixture({
    permissions: createApiFixture<AuthzApi>({ hasProjectPermission }),
  });
  await appFixture.repositories.agents.create({
    id: "source_agent",
    projectId: "source",
    name: "Current source",
    type: "signature",
    config: { prompt: "Current prompt" },
  });
  await appFixture.repositories.agents.create({
    id: "allowed_copy",
    projectId: "target",
    name: "Old copy",
    type: "signature",
    config: { prompt: "Old prompt" },
    copiedFromAgentId: "source_agent",
  });
  return { ...appFixture, hasProjectPermission };
}

describe("Agent copy authorization", () => {
  /** @scenario "Copy operations check both project boundaries" */
  it("refuses copying from an unauthorized source before persisting a target agent", async () => {
    const { app, repositories, hasProjectPermission } = await fixture();
    const before = await repositories.agents.findAll({ projectId: "target" });
    await expect(
      app.copyForActor({
        sourceAgentId: "source_agent",
        sourceProjectId: "source",
        targetProjectId: "target",
        actorId: "actor",
        actorUserId: "actor",
      }),
    ).rejects.toBeInstanceOf(AgentSourcePermissionDeniedError);

    expect(hasProjectPermission).toHaveBeenCalledWith({
      userId: "actor",
      projectId: "source",
      permission: "evaluations:manage",
    });
    expect(await repositories.agents.findAll({ projectId: "target" })).toEqual(before);
  });

  /** @scenario "Copy operations check both project boundaries" */
  it("refuses synchronization from an unauthorized source without changing the copy", async () => {
    const { app, repositories, hasProjectPermission } = await fixture();
    const reference = { id: "allowed_copy", projectId: "target" };
    const before = await repositories.agents.getById(reference);
    await expect(
      app.syncFromSourceForActor({
        agentId: reference.id,
        projectId: reference.projectId,
        actorId: "actor",
      }),
    ).rejects.toBeInstanceOf(AgentSourcePermissionDeniedError);

    expect(hasProjectPermission).toHaveBeenCalledWith({
      userId: "actor",
      projectId: "source",
      permission: "evaluations:manage",
    });
    expect(await repositories.agents.getById(reference)).toEqual(before);
  });

  /** @scenario "Copy operations check both project boundaries" */
  it("pushes changes only to selected copies in manageable projects", async () => {
    const { app, repositories, hasProjectPermission } = await fixture();
    const forbidden = await repositories.agents.create({
      id: "forbidden_copy",
      projectId: "forbidden",
      name: "Private copy",
      type: "signature",
      config: { prompt: "Private prompt" },
      copiedFromAgentId: "source_agent",
    });

    expect(
      await app.pushToCopiesForActor({
        agentId: "source_agent",
        projectId: "source",
        actorId: "actor",
        copyIds: ["allowed_copy", "forbidden_copy"],
      }),
    ).toEqual({ pushedTo: 1, selectedCopies: 1 });

    expect(hasProjectPermission).toHaveBeenCalledWith({
      userId: "actor",
      projectId: "forbidden",
      permission: "evaluations:manage",
    });
    expect(
      await repositories.agents.getById({ id: "allowed_copy", projectId: "target" }),
    ).toMatchObject({ name: "Current source", config: { prompt: "Current prompt" } });
    expect(await repositories.agents.getById(forbidden)).toEqual(forbidden);
  });
});
