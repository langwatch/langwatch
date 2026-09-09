import {
  AgentRegisterOnlyError,
  type RegisterConnectedAgentInput,
} from "@langwatch/agent-contract";
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

describe("AgentService connected Agent write guard", () => {
  it("rejects manual connected-agent creation before persistence", async () => {
    const { service, repository } = setup();

    expect(() =>
      service.create({
        projectId: registration.projectId,
        name: registration.name,
        type: "connected",
        config: registration.config,
      }),
    ).toThrow(AgentRegisterOnlyError);
    expect(await repository.findAll({ projectId: registration.projectId })).toEqual([]);
  });

  it("rejects renaming an archived connected agent and preserves its registered name", async () => {
    const { service, repository } = setup();
    await service.registerConnected(registration);
    await service.archive(registration);
    const before = await repository.getByIdIncludingArchived(registration);

    await expect(service.update({ ...registration, name: "renamed" })).rejects.toMatchObject({
      code: "agent_register_only",
    });
    expect(await repository.getByIdIncludingArchived(registration)).toEqual(before);
    expect(before.name).toBe("support-agent");
  });

  it("allows archive but refuses config and type changes", async () => {
    const { service, repository } = setup();
    await service.registerConnected(registration);
    const archived = await service.archive(registration);

    expect(archived.archivedAt).toBeInstanceOf(Date);
    await expect(
      service.update({
        id: registration.id,
        projectId: registration.projectId,
        config: { parameters: [], sdk: { name: "langwatch", version: "2", language: "python" } },
      }),
    ).rejects.toMatchObject({ code: "agent_register_only" });
    await expect(
      service.update({
        id: registration.id,
        projectId: registration.projectId,
        type: "signature",
      }),
    ).rejects.toMatchObject({ code: "agent_register_only" });
    expect(await repository.getByIdIncludingArchived(registration)).toEqual(archived);
  });

  it("does not disclose or modify a connected Agent through another project", async () => {
    const { service, repository } = setup();
    const before = await service.registerConnected(registration);
    const foreign = { id: registration.id, projectId: "project_other" };

    await expect(service.update({ ...foreign, name: "renamed" })).rejects.toMatchObject({
      code: "agent_not_found",
    });
    await expect(service.archive(foreign)).rejects.toMatchObject({ code: "agent_not_found" });
    expect(await repository.getById(registration)).toEqual(before);
  });
});
