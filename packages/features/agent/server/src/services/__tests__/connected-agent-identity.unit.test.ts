import { isConnectedAgentStale, type RegisterConnectedAgentInput } from "@langwatch/agent-contract";
import { nowInstant } from "@langwatch/time";
import { describe, expect, it } from "vitest";
import { MemoryAgentRepository } from "../../repositories/memory/memory.agent.repository.ts";
import { AgentService } from "../agent.service.ts";

const registration: RegisterConnectedAgentInput = {
  id: "agent_1",
  projectId: "project_1",
  name: "support-agent",
  config: { parameters: [], sdk: { name: "langwatch", version: "1", language: "python" } },
  identity: {
    environment: "production",
    ownerUserId: null,
    hostLabel: null,
    identityKey: "support-agent@production",
  },
};

function setup() {
  const repository = MemoryAgentRepository.create();

  return { repository, service: AgentService.create(repository) };
}

describe("AgentService connected identity registration", () => {
  it("creates one connected row for its name and environment", async () => {
    const { service, repository } = setup();
    const row = await service.registerConnected(registration);

    expect(row).toMatchObject({
      id: registration.id,
      type: "connected",
      name: registration.name,
      environment: "production",
      identityKey: registration.identity.identityKey,
    });
    expect(await repository.findAll(registration)).toHaveLength(1);
  });

  it("updates config and name on the same identity without changing its creation timestamp", async () => {
    const { service, repository } = setup();
    const first = await service.registerConnected(registration);
    const second = await service.registerConnected({
      ...registration,
      id: "agent_2",
      name: "support-agent-renamed",
      config: { ...registration.config, timeoutMs: 9000 },
    });

    expect(second).toMatchObject({
      id: first.id,
      createdAt: first.createdAt,
      name: "support-agent-renamed",
      config: { timeoutMs: 9000 },
    });
    expect(await repository.findAll(registration)).toHaveLength(1);
    expect(await repository.exists({ ...registration, id: "agent_2" })).toBe(false);
  });

  it("converges concurrent registrations on one stored Agent", async () => {
    const { service, repository } = setup();
    const [first, second] = await Promise.all([
      service.registerConnected({ ...registration, id: "agent_a" }),
      service.registerConnected({ ...registration, id: "agent_b" }),
    ]);

    expect(first.id).toBe(second.id);
    expect(await repository.findAll(registration)).toHaveLength(1);
    expect(await repository.getById({ ...registration, id: first.id })).toMatchObject({
      identityKey: registration.identity.identityKey,
      type: "connected",
    });
  });

  it("refreshes stale presence and restores visibility without changing the Agent id", async () => {
    const { service, repository } = setup();
    const existing = await service.registerConnected(registration);
    await service.touchLastSeenAt({
      ...registration,
      at: nowInstant().subtract({ milliseconds: 31 * 86400000 }),
    });
    expect(await service.getAll(registration)).toEqual([]);

    const refreshed = await service.registerConnected({ ...registration, id: "new-id" });

    expect(refreshed.id).toBe(existing.id);
    expect(refreshed.lastSeenAt).toBeInstanceOf(Date);
    expect(isConnectedAgentStale({ lastSeenAt: refreshed.lastSeenAt })).toBe(false);
    expect(await repository.findAll(registration)).toHaveLength(1);
    expect((await service.getAll(registration)).map((agent) => agent.id)).toEqual([existing.id]);
  });

  it("revives an archived identity instead of creating a new row", async () => {
    const { service, repository } = setup();
    const existing = await service.registerConnected(registration);
    await service.archive(registration);
    expect((await repository.getByIdIncludingArchived(registration)).archivedAt).toBeInstanceOf(
      Date,
    );

    const restored = await service.registerConnected({ ...registration, id: "new-id" });

    expect(restored).toMatchObject({ id: existing.id, archivedAt: null });
    expect(await repository.findAll(registration)).toHaveLength(1);
  });

  it("keeps identical identity keys in different projects separate", async () => {
    const { service, repository } = setup();
    const first = await service.registerConnected(registration);
    const second = await service.registerConnected({
      ...registration,
      id: "agent_other_project",
      projectId: "project_other",
      config: { ...registration.config, timeoutMs: 9000 },
    });

    expect(second.id).not.toBe(first.id);
    expect(await repository.getById(registration)).toEqual(first);
    expect(
      await service.getConnectedByName({ projectId: "project_other", name: registration.name }),
    ).toEqual([second]);
    expect(
      await service.getConnectedByNameAndEnvironment({
        projectId: registration.projectId,
        name: registration.name,
        environment: "production",
      }),
    ).toEqual([first]);
  });
});
