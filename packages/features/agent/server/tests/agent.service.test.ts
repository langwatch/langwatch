import type { AgentsDatabase } from "../src";
import { PrismaAgentAdapter } from "../src";
import { describe, expect, it, vi } from "vitest";

function row(overrides: Record<string, unknown> = {}) {
  return {
    id: "agent_1",
    projectId: "project_1",
    name: "Answerer",
    type: "signature",
    config: {
      prompt: "Answer clearly",
      inputs: [{ identifier: "question", type: "str" as const }],
      outputs: [{ identifier: "answer", type: "str" as const }],
    },
    workflowId: null,
    copiedFromAgentId: null,
    archivedAt: null,
    createdAt: new Date(0),
    updatedAt: new Date(0),
    ...overrides,
  };
}

function setup() {
  const create = vi.fn(async ({ data }: { data: Record<string, unknown> }) =>
    row(data),
  );
  const database = {
    agent: {
      findFirst: vi.fn(async () => null),
      findMany: vi.fn(async () => []),
      count: vi.fn(async () => 0),
      create,
      update: vi.fn(async () => row()),
    },
  } as unknown as AgentsDatabase;
  const service = PrismaAgentAdapter.create({
    database,
    workflows: {
      fields: async () => ({}),
      related: async () => null,
      copy: async () => ({ workflowId: "workflow_copy" }),
      archive: async ({ workflowId }) => ({ id: workflowId }),
      remove: async () => undefined,
    },
    auditLog: { history: async () => [] },
    generateId: () => "agent_generated",
  });
  return { service, create, database };
}

describe("Agents service", () => {
  /** @scenario The RPC API owns the canonical Agent operations */
  it("validates, persists, and enriches a created agent", async () => {
    const { service, create } = setup();
    const agent = await service.create({
      projectId: "project_1",
      name: "Answerer",
      type: "signature",
      config: row().config,
    });

    expect(agent).toMatchObject({
      id: "agent_generated",
      fieldsResolved: true,
      inputFields: [{ identifier: "question", type: "str" }],
      outputFields: [{ identifier: "answer", type: "str" }],
    });
    expect(create).toHaveBeenCalledOnce();
  });

  it("rejects a config that does not match its declared type before persistence", async () => {
    const { service, create } = setup();
    await expect(
      service.create({
        projectId: "project_1",
        name: "Broken code",
        type: "code",
        config: { parameters: [] },
      }),
    ).rejects.toMatchObject({ name: "InvalidAgentConfigError" });
    expect(create).not.toHaveBeenCalled();
  });

  it("checks active references without leaking the repository", async () => {
    const { service, database } = setup();
    vi.mocked(database.agent.findFirst).mockResolvedValue({ id: "agent_1" });

    await expect(
      service.exists({ id: "agent_1", projectId: "project_1" }),
    ).resolves.toBe(true);
    expect(database.agent.findFirst).toHaveBeenCalledWith({
      where: {
        id: "agent_1",
        projectId: "project_1",
        archivedAt: null,
      },
      select: { id: true },
    });
  });

  it("throws a concrete error carrying both identifiers when an agent is absent", async () => {
    const { service } = setup();

    await expect(
      service.getById({ id: "agent_missing", projectId: "project_1" }),
    ).rejects.toMatchObject({
      name: "AgentNotFoundError",
      agentId: "agent_missing",
      projectId: "project_1",
    });
  });

  it("does not persist a type-only update with an incompatible config", async () => {
    const { service, database } = setup();
    vi.mocked(database.agent.findFirst).mockResolvedValue(row());

    await expect(
      service.update({
        id: "agent_1",
        projectId: "project_1",
        type: "code",
      }),
    ).rejects.toMatchObject({ name: "InvalidAgentConfigError" });
    expect(database.agent.update).not.toHaveBeenCalled();
  });
});
