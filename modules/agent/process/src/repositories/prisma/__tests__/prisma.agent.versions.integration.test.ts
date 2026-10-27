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
});
