import {
  AgentAlreadyExistsError,
  AgentNotFoundError,
  AgentSourceNotFoundError,
} from "@langwatch/agent-contract";
import { nowInstant } from "@langwatch/time";
import { describe, expect, it } from "vitest";
import type { PersistAgentInput, RegisterPersistedAgentInput } from "../../agent.repository.ts";
import { MemoryAgentRepository } from "../memory.agent.repository.ts";
import { MemoryAgentRepositories } from "../memory.agent.repositories.ts";

function agent(id: string, projectId = "project-a"): PersistAgentInput {
  return { id, projectId, name: id, type: "workflow", config: {} };
}

function connected(id: string, projectId = "project-a"): RegisterPersistedAgentInput {
  return {
    ...agent(id, projectId),
    name: "support",
    type: "connected",
    config: { parameters: [], sdk: { name: "langwatch", version: "1", language: "python" } },
    identity: {
      identityKey: "support-production",
      environment: "production",
      ownerUserId: null,
      hostLabel: null,
    },
  };
}

describe("MemoryAgentRepository", () => {
  it("scopes workflow configs and keeps detached metadata when mappings change", async () => {
    const repository = MemoryAgentRepository.create();
    await repository.create({ ...agent("a"), workflowId: "workflow-a" });
    await repository.create({ ...agent("b", "project-b"), workflowId: "workflow-a" });
    await repository.create({ ...agent("c"), workflowId: "workflow-b" });
    await repository.create({ ...agent("archived"), workflowId: "workflow-a" });
    await repository.archive(agent("archived"));

    const scope = { projectId: "project-a", workflowId: "workflow-a" };
    expect(await repository.listWorkflowConfigs(scope)).toEqual([{ id: "a", config: {} }]);
    const config = { customMetadata: { value: "retained" }, scenarioOutputField: "answer" };
    await repository.updateWorkflowConfig({ ...scope, id: "a", config });
    config.customMetadata.value = "changed";
    expect(await repository.listWorkflowConfigs(scope)).toEqual([
      { id: "a", config: { customMetadata: { value: "retained" }, scenarioOutputField: "answer" } },
    ]);
    await expect(
      repository.updateWorkflowConfig({ ...scope, id: "b", config: {} }),
    ).rejects.toBeInstanceOf(AgentNotFoundError);
    await expect(
      repository.updateWorkflowConfig({ ...scope, id: "c", config: {} }),
    ).rejects.toBeInstanceOf(AgentNotFoundError);
  });

  it("isolates repository bundles and detached input and output values", async () => {
    const first = MemoryAgentRepositories.create().agents;
    const second = MemoryAgentRepositories.create().agents;
    const input = {
      ...agent("a"),
      config: { name: "original", versions: { v1: { name: "saved" } } },
    };
    const created = await first.create(input);
    input.config.name = "changed input";
    input.config.versions.v1.name = "changed nested input";
    created.name = "changed output";
    created.createdAt.setTime(0);
    created.config.name = "changed output";

    const saved = await first.getById(input);
    expect(saved).toMatchObject({
      name: "a",
      config: { name: "original", versions: { v1: { name: "saved" } } },
    });
    expect(saved.createdAt.getTime()).toBeGreaterThan(0);
    await expect(second.getById(input)).rejects.toBeInstanceOf(AgentNotFoundError);
  });

  it("rejects reads and writes targeting another project", async () => {
    const repository = MemoryAgentRepository.create();
    await repository.create(agent("a"));
    const foreign = agent("a", "project-b");

    await expect(repository.getById(foreign)).rejects.toBeInstanceOf(AgentNotFoundError);
    await expect(repository.getByIdIncludingArchived(foreign)).rejects.toBeInstanceOf(
      AgentNotFoundError,
    );
    await expect(repository.update(foreign)).rejects.toBeInstanceOf(AgentNotFoundError);
    await expect(repository.archive(foreign)).rejects.toBeInstanceOf(AgentNotFoundError);
    await expect(repository.updateNameAndConfig(foreign)).rejects.toBeInstanceOf(
      AgentNotFoundError,
    );
    await expect(
      repository.touchLastSeenAt({ ...foreign, at: nowInstant() }),
    ).rejects.toBeInstanceOf(AgentNotFoundError);
    expect(await repository.exists(foreign)).toBe(false);
    expect(await repository.findAll(foreign)).toEqual([]);
    expect(await repository.findPage({ ...foreign, page: 1, limit: 10 })).toEqual({
      data: [],
      total: 0,
    });
    expect(await repository.findNamesByIds({ ids: ["a"], projectId: foreign.projectId })).toEqual(
      [],
    );
    expect(
      await repository.findReferenceStates({ ids: ["a"], projectId: foreign.projectId }),
    ).toEqual([]);
  });

  it("retains archived reference state while hiding ordinary reads", async () => {
    const repository = MemoryAgentRepository.create();
    const input = agent("a");
    await repository.create(input);
    const archived = await repository.archive(input);

    expect(archived.archivedAt).toBeInstanceOf(Date);
    await expect(repository.archive(input)).rejects.toBeInstanceOf(AgentNotFoundError);
    await expect(repository.getById(input)).rejects.toBeInstanceOf(AgentNotFoundError);
    await expect(repository.getByIdOnly(input.id)).rejects.toBeInstanceOf(AgentSourceNotFoundError);
    expect(await repository.exists(input)).toBe(false);
    expect(await repository.findAll(input)).toEqual([]);
    expect(await repository.getByIdIncludingArchived(input)).toEqual(archived);
    expect(
      await repository.findNamesByIds({ ids: [input.id], projectId: input.projectId }),
    ).toEqual([{ id: input.id, name: input.name }]);
    const states = await repository.findReferenceStates({
      ids: [input.id],
      projectId: input.projectId,
    });
    expect(states).toMatchObject([{ id: input.id, archivedAt: archived.archivedAt }]);
    states[0]?.archivedAt?.setTime(0);
    expect((await repository.getByIdIncludingArchived(input)).archivedAt).toEqual(
      archived.archivedAt,
    );
  });

  it("rejects duplicate ids across projects and duplicate identities without overwriting", async () => {
    const repository = MemoryAgentRepository.create();
    await repository.create(connected("a"));

    await expect(repository.create(agent("a", "project-b"))).rejects.toBeInstanceOf(
      AgentAlreadyExistsError,
    );
    await expect(repository.create(connected("b"))).rejects.toBeInstanceOf(AgentAlreadyExistsError);
    expect(await repository.getByIdOnly("a")).toMatchObject({
      projectId: "project-a",
      name: "support",
    });
    expect(await repository.exists(agent("b"))).toBe(false);
  });

  it("atomically registers the same identity once and revives its original row", async () => {
    const repository = MemoryAgentRepository.create();
    const results = await Promise.all([
      repository.registerConnected(connected("a")),
      repository.registerConnected(connected("b")),
    ]);

    expect(results.map((result) => result.id)).toEqual(["a", "a"]);
    await repository.archive(agent("a"));
    const revived = await repository.registerConnected({ ...connected("c"), name: "renamed" });
    expect(revived).toMatchObject({
      id: "a",
      name: "renamed",
      archivedAt: null,
      createdAt: results[0]?.createdAt,
    });
    expect(revived.lastSeenAt).toBeInstanceOf(Date);
    expect(await repository.findAll(agent("a"))).toHaveLength(1);
    const otherProject = await repository.registerConnected(connected("d", "project-b"));
    expect(otherProject.id).toBe("d");
  });

  it("excludes stale connected rows from lists until presence is refreshed", async () => {
    const repository = MemoryAgentRepository.create();
    const input = connected("a");
    await repository.registerConnected(input);
    await repository.touchLastSeenAt({
      ...input,
      at: nowInstant().subtract({ milliseconds: 31 * 86_400_000 }),
    });
    await repository.create(agent("ordinary"));

    expect((await repository.findAll(input)).map((row) => row.id)).toEqual(["ordinary"]);
    expect(await repository.findConnectedByName(input)).toEqual([]);
    expect(
      await repository.findConnectedByNameAndEnvironment({ ...input, environment: "production" }),
    ).toEqual([]);
    expect((await repository.findPage({ ...input, page: 1, limit: 10 })).total).toBe(1);
    expect(await repository.getById(input)).toMatchObject({ id: "a" });
    await repository.touchLastSeenAt({ ...input, at: nowInstant() });
    expect(
      await repository.findConnectedByNameAndEnvironment({ ...input, environment: "production" }),
    ).toHaveLength(1);
    expect(
      await repository.findConnectedByNameAndEnvironment({ ...input, environment: "development" }),
    ).toEqual([]);
    expect(await repository.findConnectedByName({ ...input, projectId: "project-b" })).toEqual([]);
  });

  it("paginates only the requested project and returns detached list rows", async () => {
    const repository = MemoryAgentRepository.create();
    await repository.create(agent("a"));
    await repository.create(agent("b"));
    await repository.create(agent("foreign", "project-b"));
    const first = await repository.findPage({ projectId: "project-a", page: 1, limit: 1 });
    const second = await repository.findPage({ projectId: "project-a", page: 2, limit: 1 });

    expect(first.total).toBe(2);
    expect(second.total).toBe(2);
    expect(new Set([...first.data, ...second.data].map((row) => row.id))).toEqual(
      new Set(["a", "b"]),
    );
    expect(first.data).toHaveLength(1);
    expect(second.data).toHaveLength(1);
    const row = first.data[0];
    if (!row) throw new Error("Expected first page row");
    row.name = "changed";
    expect((await repository.getById(row)).name).toBe(row.id);
  });

  it("updates config and lists live copies without project enrichment", async () => {
    const repository = MemoryAgentRepository.create();
    await repository.create(agent("source"));
    await repository.create({ ...agent("copy", "project-b"), copiedFromAgentId: "source" });
    await repository.create({ ...agent("archived", "project-b"), copiedFromAgentId: "source" });
    await repository.archive(agent("archived", "project-b"));
    await repository.updateNameAndConfig({
      ...agent("copy", "project-b"),
      name: "updated copy",
      config: { name: "updated config" },
    });

    expect(await repository.findCopies("source")).toEqual([
      { id: "copy", name: "updated copy", projectId: "project-b" },
    ]);
    expect(await repository.findAll(agent("source"))).toMatchObject([
      { id: "source", copyCount: 2 },
    ]);
    expect(await repository.getByIdOnly("copy")).toMatchObject({
      config: { name: "updated config" },
    });
    const updated = await repository.update({
      ...agent("copy", "project-b"),
      name: "updated again",
      config: { name: "new config" },
      workflowId: "workflow-new",
    });
    expect(updated).toMatchObject({
      name: "updated again",
      config: { name: "new config" },
      workflowId: "workflow-new",
    });
  });
});
