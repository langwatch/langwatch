/**
 * Agent versions and deploy labels against Postgres: each write appends a version in the same
 * transaction, labels move between versions, and the backfill writes version 1 once.
 */
import { randomUUID } from "node:crypto";

import { parseAgentConfig } from "@langwatch/agent-contract";
import { createLogger } from "@langwatch/observability";
import {
  PrismaConfigService,
  PrismaConnectionService,
  PrismaTenancyGuardService,
  type PrismaConnection,
} from "@langwatch/prisma-client";
import { fromDate } from "@langwatch/time";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { PrismaAgentRepository } from "../prisma.agent.repository.ts";

const databaseUrl = process.env.LANGWATCH_TEST_DATABASE_URL;
const namespace = `test-agent-versions-${randomUUID()}`;
const projectId = `${namespace}-project`;
const teamId = `${namespace}-team`;
const organizationId = `${namespace}-organization`;
const agentId = `${namespace}-agent`;
const userAuthor = { authorId: "user_versions_ada", authorKind: "user" } as const;

function configAt(prompt: string) {
  return parseAgentConfig("signature", {
    prompt,
    inputs: [{ identifier: "question", type: "str" }],
    outputs: [{ identifier: "answer", type: "str" }],
  });
}

describe.skipIf(!databaseUrl)("Prisma agent versions", () => {
  let connection: PrismaConnection;
  let repository: PrismaAgentRepository;

  beforeAll(async () => {
    if (!databaseUrl) throw new Error("Test database URL is required");
    connection = PrismaConnectionService.create({
      guard: PrismaTenancyGuardService.create(),
      logger: createLogger("langwatch:agent:test:versions"),
    }).connect(PrismaConfigService.create().resolve({ databaseUrl, log: ["error"] }));
    const prisma = connection.client;
    repository = PrismaAgentRepository.create({ prisma });
    await prisma.organization.create({
      data: { id: organizationId, name: namespace, slug: namespace },
    });
    await prisma.team.create({
      data: { id: teamId, organizationId, name: namespace, slug: namespace },
    });
    await prisma.project.create({
      data: {
        id: projectId,
        teamId,
        name: projectId,
        slug: projectId,
        apiKey: projectId,
        language: "typescript",
        framework: "test",
      },
    });
  });

  afterAll(async () => {
    if (!connection) return;
    const prisma = connection.client;
    await prisma.agentVersionLabel.deleteMany({ where: { projectId } });
    await prisma.agentVersion.deleteMany({ where: { projectId } });
    await prisma.agent.deleteMany({ where: { projectId } });
    await prisma.project.deleteMany({ where: { id: projectId } });
    await prisma.team.deleteMany({ where: { id: teamId } });
    await prisma.organization.deleteMany({ where: { id: organizationId } });
    await connection.closeOnce();
  });

  /** @scenario "Every update appends a version and keeps the head as latest" */
  it("appends a version per update and moves a label between versions", async () => {
    await repository.create({
      id: agentId,
      projectId,
      name: "Support bot",
      type: "signature",
      config: configAt("v1"),
      author: userAuthor,
    });
    await repository.update({
      id: agentId,
      projectId,
      type: "signature",
      config: configAt("v2"),
      commitMessage: "Use the new endpoint",
      author: userAuthor,
    });

    const head = await repository.getById({ id: agentId, projectId });
    expect([head.createdById, head.updatedById]).toEqual([
      "user_versions_ada",
      "user_versions_ada",
    ]);
    const [listed] = await repository.findAll({ projectId });
    expect(listed?.createdById).toBe("user_versions_ada");

    const versions = await repository.findVersions({ projectId, agentId });
    expect(versions.map((row) => [row.version, row.commitMessage])).toEqual([
      [2, "Use the new endpoint"],
      [1, null],
    ]);
    for (const version of [...versions].reverse()) {
      await repository.assignLabel({
        projectId,
        agentId,
        label: "production",
        versionId: version.id,
        actorId: null,
      });
    }
    const labels = await repository.findLabels({ projectId, ids: [agentId] });
    expect(labels.map((row) => [row.label, row.version])).toEqual([["production", 2]]);
    expect(
      (await repository.findVersion({ projectId, agentId, version: 1 }))?.config,
    ).toMatchObject({ prompt: "v1" });
    expect(await repository.removeLabel({ projectId, agentId, label: "production" })).toBe(true);
  });

  /** @scenario "A system config write appends a version too" */
  it("appends a version when a workflow sync or a credential move writes the config", async () => {
    const workflowAgentId = `${namespace}-workflow`;
    const workflowId = `${namespace}-workflow-id`;
    const created = await repository.create({
      id: workflowAgentId,
      projectId,
      name: "Workflow bot",
      type: "signature",
      config: configAt("v1"),
      workflowId,
      author: userAuthor,
    });
    await repository.updateWorkflowConfig({
      id: workflowAgentId,
      projectId,
      workflowId,
      config: configAt("v2"),
    });
    const head = await repository.getById({ id: workflowAgentId, projectId });
    expect(
      await repository.updateConfigIfUnchanged({
        id: workflowAgentId,
        projectId,
        config: configAt("stale"),
        updatedAt: fromDate(created.updatedAt),
      }),
    ).toBe(false);
    expect(
      await repository.updateConfigIfUnchanged({
        id: workflowAgentId,
        projectId,
        config: configAt("v3"),
        updatedAt: fromDate(head.updatedAt),
      }),
    ).toBe(true);

    const versions = await repository.findVersions({ projectId, agentId: workflowAgentId });
    expect(
      versions.map((row) => [row.version, (row.config as { prompt?: string }).prompt]),
    ).toEqual([
      [3, "v3"],
      [2, "v2"],
      [1, "v1"],
    ]);
  });

  /** @scenario "Existing agents get version 1 from their current config" */
  it("backfills version 1 for an agent written before versions existed, once", async () => {
    const oldId = `${namespace}-old`;
    await connection.client.agent.create({
      data: {
        id: oldId,
        projectId,
        name: "Old bot",
        type: "signature",
        config: configAt("current") as object,
      },
    });

    const page = await repository.findUnversioned({ afterId: null, limit: 10_000 });
    const old = page.find((row) => row.id === oldId);
    expect(old).toBeDefined();
    expect(await repository.backfillFirstVersion({ agent: old!, createdById: null })).toBe(true);
    expect(await repository.backfillFirstVersion({ agent: old!, createdById: null })).toBe(false);
    const versions = await repository.findVersions({ projectId, agentId: oldId });
    expect(versions.map((row) => row.version)).toEqual([1]);
  });

  /** @scenario "A legacy agent's first save keeps its old config as version 1" */
  it("records the pre-version config as version 1 before the first save", async () => {
    const legacyId = `${namespace}-legacy`;
    await connection.client.agent.create({
      data: {
        id: legacyId,
        projectId,
        name: "Legacy bot",
        type: "signature",
        config: configAt("before") as object,
      },
    });

    await repository.update({
      id: legacyId,
      projectId,
      type: "signature",
      config: configAt("after"),
      author: userAuthor,
    });

    const versions = await repository.findVersions({ projectId, agentId: legacyId });
    expect(
      versions.map((row) => [row.version, (row.config as { prompt?: string }).prompt]),
    ).toEqual([
      [2, "after"],
      [1, "before"],
    ]);
  });

  /** @scenario "No version copies a typed-in HTTP credential" */
  it("skips archived agents and typed-in credentials when recording version 1", async () => {
    const archivedId = `${namespace}-archived`;
    const literalId = `${namespace}-literal`;
    const literal = {
      url: "https://a.example",
      method: "POST",
      auth: { type: "bearer", token: "tok_live_old_123" },
    };
    await connection.client.agent.createMany({
      data: [
        {
          id: archivedId,
          projectId,
          name: "Archived bot",
          type: "http",
          config: literal,
          archivedAt: new Date(),
        },
        { id: literalId, projectId, name: "Literal bot", type: "http", config: literal },
      ],
    });
    const page = await repository.findUnversioned({ afterId: null, limit: 10_000 });
    expect(page.some((row) => row.id === archivedId)).toBe(false);

    const head = await repository.getById({ id: literalId, projectId });
    const moved = { ...literal, auth: { type: "bearer", token: "{{ secrets.LITERAL_BOT }}" } };
    expect(
      await repository.updateConfigIfUnchanged({
        id: literalId,
        projectId,
        config: parseAgentConfig("http", moved),
        updatedAt: fromDate(head.updatedAt),
      }),
    ).toBe(true);

    const versions = await repository.findVersions({ projectId, agentId: literalId });
    expect(versions.map((row) => row.version)).toEqual([1]);
    expect(JSON.stringify(versions)).not.toContain("tok_live_old_123");
  });
});
