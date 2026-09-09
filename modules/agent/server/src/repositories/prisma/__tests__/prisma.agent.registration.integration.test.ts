import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  PrismaConfigService,
  PrismaConnectionService,
  PrismaQueryGuard,
  type PrismaConnection,
  type PrismaQueryContext,
  type PrismaQueryExecutor,
} from "@langwatch/prisma-client";
import { AgentNotFoundError, type RegisterConnectedAgentInput } from "@langwatch/agent-contract";
import { PrismaAgentRepository } from "../prisma.agent.repository.ts";

class RegistrationTestQueries extends PrismaQueryGuard {
  execute(context: PrismaQueryContext, next: PrismaQueryExecutor): Promise<unknown> {
    return next(context.args);
  }
}

const databaseUrl = process.env.LANGWATCH_TEST_DATABASE_URL ?? process.env.DATABASE_URL;
const namespace = `test-agent-registration-${randomUUID()}`;
const projectId = `${namespace}-project`;
const otherProjectId = `${namespace}-other`;
const teamId = `${namespace}-team`;
const organizationId = `${namespace}-organization`;

describe.skipIf(!databaseUrl)("Prisma Agent registration", () => {
  let connection: PrismaConnection;
  let repository: PrismaAgentRepository;

  beforeAll(async () => {
    if (!databaseUrl) throw new Error("Test database URL is required");
    connection = PrismaConnectionService.create({ guard: new RegistrationTestQueries() }).connect(
      PrismaConfigService.create().resolve({ databaseUrl, log: ["error"] }),
    );
    const prisma = connection.client;
    repository = PrismaAgentRepository.create({ prisma });

    await prisma.organization.create({
      data: { id: organizationId, name: namespace, slug: namespace },
    });
    await prisma.team.create({
      data: { id: teamId, organizationId, name: namespace, slug: namespace },
    });
    for (const id of [projectId, otherProjectId]) {
      await prisma.project.create({
        data: {
          id,
          teamId,
          name: id,
          slug: id,
          apiKey: id,
          language: "typescript",
          framework: "test",
        },
      });
    }
  });

  afterAll(async () => {
    if (!connection) return;
    const prisma = connection.client;
    await prisma.agent.deleteMany({ where: { projectId: { in: [projectId, otherProjectId] } } });
    await prisma.workflow.deleteMany({ where: { projectId: { in: [projectId, otherProjectId] } } });
    await prisma.project.deleteMany({ where: { id: { in: [projectId, otherProjectId] } } });
    await prisma.team.deleteMany({ where: { id: teamId } });
    await prisma.organization.deleteMany({ where: { id: organizationId } });
    await connection.closeOnce();
  });

  function registration(
    id: string,
    project = projectId,
  ): RegisterConnectedAgentInput & { type: "connected" } {
    return {
      id,
      projectId: project,
      name: "support",
      type: "connected",
      config: { parameters: [], sdk: { name: "langwatch", language: "typescript", version: "1" } },
      identity: {
        identityKey: "support@production",
        environment: "production",
        ownerUserId: null,
        hostLabel: null,
      },
    };
  }

  /** @scenario "Concurrent SDK registrations preserve one project identity" */
  it("converges simultaneous registrations onto one identity without changing its id", async () => {
    const answers = await Promise.all(
      Array.from({ length: 12 }, (_, index) =>
        repository.registerConnected(registration(`${namespace}-${index}`)),
      ),
    );
    const ids = new Set(answers.map((answer) => answer.id));
    expect(ids.size).toBe(1);
    expect(await connection.client.agent.count({ where: { projectId } })).toBe(1);

    const first = answers[0]!;
    await repository.archive({ id: first.id, projectId });
    await expect(repository.archive({ id: first.id, projectId })).rejects.toBeInstanceOf(
      AgentNotFoundError,
    );
    const revived = await repository.registerConnected({
      ...registration(`${namespace}-new`),
      name: "renamed",
    });
    expect(revived).toMatchObject({ id: first.id, archivedAt: null, name: "renamed", projectId });
  });

  /** @scenario "Concurrent SDK registrations preserve one project identity" */
  /** @scenario "Extra application facts cannot alter persistence scope" */
  it("keeps the same identity separate in another project and refuses cross-project writes", async () => {
    const first = await repository.registerConnected(registration(`${namespace}-first`));
    const other = await repository.registerConnected(
      registration(`${namespace}-second`, otherProjectId),
    );
    expect(first.id).not.toBe(other.id);
    await expect(
      repository.getById({ id: first.id, projectId: otherProjectId }),
    ).rejects.toBeInstanceOf(AgentNotFoundError);
    await expect(
      repository.archive({ id: first.id, projectId: otherProjectId }),
    ).rejects.toBeInstanceOf(AgentNotFoundError);
    expect(await repository.getById({ id: first.id, projectId })).toMatchObject({
      archivedAt: null,
    });
  });

  /** @scenario "Extra application facts cannot alter persistence scope" */
  it("selects query fields explicitly when App inputs carry viewer and actor metadata", async () => {
    const agent = await repository.registerConnected(registration(`${namespace}-metadata`));
    const input = {
      id: agent.id,
      projectId,
      viewerUserId: "viewer",
      actorId: "actor",
      message: "test",
      params: {},
    };

    expect(await repository.getById(input)).toMatchObject({ id: agent.id });
    expect(await repository.findAll(input)).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: agent.id })]),
    );
    expect(await repository.exists(input)).toBe(true);
  });

  /** @scenario "Optional SDK config is stored as JSON" */
  it("persists SDK config with omitted optional fields as JSON", async () => {
    const input = registration(`${namespace}-optional`);
    const agent = await repository.registerConnected({
      ...input,
      config: {
        ...input.config,
        concurrency: void 0,
        sticky: void 0,
        parameters: [{ name: "message", type: "string", defaultValue: void 0 }],
      },
    });
    const stored = await connection.client.agent.findUniqueOrThrow({ where: { id: agent.id } });

    expect(stored.config).toEqual({
      sdk: input.config.sdk,
      parameters: [{ name: "message", type: "string" }],
    });
  });

  /** @scenario "Optional SDK config is stored as JSON" */
  it("refuses non-JSON SDK values without changing the persisted identity", async () => {
    const input = registration(`${namespace}-invalid-json`);
    const before = await repository.registerConnected(input);

    await expect(
      repository.registerConnected({
        ...input,
        config: { ...input.config, timeoutMs: Number.NaN },
      }),
    ).rejects.toMatchObject({ name: "ZodError" });

    expect(await repository.getById({ id: before.id, projectId })).toEqual(before);
  });

  it("omits stale connected agents from list and pagination", async () => {
    const input = registration(`${namespace}-stale`);
    const stale = await repository.registerConnected({
      ...input,
      identity: { ...input.identity, identityKey: "stale@production" },
    });
    const fresh = await repository.registerConnected(registration(`${namespace}-fresh`));
    await connection.client.agent.update({
      where: { id: stale.id },
      data: { lastSeenAt: new Date(Date.now() - 31 * 24 * 60 * 60 * 1000) },
    });
    const agents = await repository.findAll({ projectId });
    const page = await repository.findPage({ projectId, page: 1, limit: 20 });

    expect(agents.map((agent) => agent.id)).toContain(fresh.id);
    expect(agents.map((agent) => agent.id)).not.toContain(stale.id);
    expect(page.data.map((agent) => agent.id)).toEqual(agents.map((agent) => agent.id));
    expect(page.total).toBe(agents.length);
  });

  it("scopes workflow config reads and writes while preserving unrelated JSON fields", async () => {
    const workflowId = `${namespace}-workflow`;
    const otherWorkflowId = `${namespace}-other-workflow`;
    for (const id of [workflowId, otherWorkflowId]) {
      await connection.client.workflow.create({
        data: { id, projectId, name: id, icon: "x", description: "test" },
      });
    }
    const id = `${namespace}-workflow-agent`;
    const config = { customMetadata: { retained: true }, scenarioOutputField: "old" };
    await connection.client.agent.createMany({
      data: [
        { id, projectId, workflowId, name: id, type: "workflow", config },
        {
          id: `${id}-foreign`,
          projectId: otherProjectId,
          workflowId,
          name: id,
          type: "workflow",
          config,
        },
        {
          id: `${id}-archived`,
          projectId,
          workflowId,
          name: id,
          type: "workflow",
          config,
          archivedAt: new Date(),
        },
        {
          id: `${id}-other-workflow`,
          projectId,
          workflowId: otherWorkflowId,
          name: id,
          type: "workflow",
          config,
        },
      ],
    });

    const scope = { projectId, workflowId };
    const requestScope = { ...scope, actorId: "extra" };
    expect(await repository.listWorkflowConfigs(requestScope)).toEqual([{ id, config }]);
    const updated = { ...config, scenarioOutputField: "answer" };
    await repository.updateWorkflowConfig({ ...scope, id, config: updated });
    expect(await repository.listWorkflowConfigs(scope)).toEqual([{ id, config: updated }]);
    await expect(
      repository.updateWorkflowConfig({ ...scope, projectId: otherProjectId, id, config: {} }),
    ).rejects.toBeInstanceOf(AgentNotFoundError);
    await expect(
      repository.updateWorkflowConfig({ ...scope, workflowId: otherWorkflowId, id, config: {} }),
    ).rejects.toBeInstanceOf(AgentNotFoundError);
    expect((await connection.client.agent.findUniqueOrThrow({ where: { id } })).config).toEqual(
      updated,
    );
  });
});
