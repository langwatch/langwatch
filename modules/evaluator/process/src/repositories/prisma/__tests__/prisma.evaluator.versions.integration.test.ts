/**
 * Evaluator versions and deploy labels against Postgres: each write appends a version in the
 * same transaction, a write that changes nothing appends none, and labels move between versions.
 */
import { randomUUID } from "node:crypto";

import { createLogger } from "@langwatch/observability";
import {
  PrismaConfigService,
  PrismaConnectionService,
  PrismaTenancyGuardService,
  type PrismaConnection,
} from "@langwatch/prisma-client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { PrismaEvaluatorRepository } from "../prisma.evaluator.repository.ts";

const databaseUrl = process.env.LANGWATCH_TEST_DATABASE_URL;
const namespace = `test-evaluator-versions-${randomUUID()}`;
const projectId = `${namespace}-project`;
const teamId = `${namespace}-team`;
const organizationId = `${namespace}-organization`;
const evaluatorId = `${namespace}-evaluator`;
const author = { authorId: null, authorKind: "api_key" } as const;

function configAt(threshold: number) {
  return { evaluatorType: "langevals/toxicity", settings: { threshold } };
}

describe.skipIf(!databaseUrl)("Prisma evaluator versions", () => {
  let connection: PrismaConnection;
  let repository: PrismaEvaluatorRepository;

  beforeAll(async () => {
    if (!databaseUrl) throw new Error("Test database URL is required");
    connection = PrismaConnectionService.create({
      guard: PrismaTenancyGuardService.create(),
      logger: createLogger("langwatch:evaluator:test:versions"),
    }).connect(PrismaConfigService.create().resolve({ databaseUrl, log: ["error"] }));
    const prisma = connection.client;
    repository = PrismaEvaluatorRepository.create({ prisma });
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
    await prisma.evaluatorVersionLabel.deleteMany({ where: { projectId } });
    await prisma.evaluatorVersion.deleteMany({ where: { projectId } });
    await prisma.evaluator.deleteMany({ where: { projectId } });
    await prisma.project.deleteMany({ where: { id: projectId } });
    await prisma.team.deleteMany({ where: { id: teamId } });
    await prisma.organization.deleteMany({ where: { id: organizationId } });
    await connection.closeOnce();
  });

  /** @scenario "Every update appends a version and keeps the head as latest" */
  it("appends a version per change, none for a no-op, and moves a label between versions", async () => {
    await repository.create({
      id: evaluatorId,
      projectId,
      name: "Toxicity",
      type: "evaluator",
      config: configAt(1),
      author,
    });
    await repository.update({
      id: evaluatorId,
      projectId,
      data: { config: configAt(2) },
      commitMessage: "Raise the threshold",
      author,
    });
    await repository.update({ id: evaluatorId, projectId, data: { config: configAt(2) }, author });

    const versions = await repository.findVersions({ projectId, evaluatorId });
    expect(versions.map((row) => [row.version, row.commitMessage])).toEqual([
      [2, "Raise the threshold"],
      [1, null],
    ]);

    const first = versions.find((row) => row.version === 1)!;
    const second = versions.find((row) => row.version === 2)!;
    await repository.assignLabel({
      projectId,
      evaluatorId,
      label: "production",
      versionId: first.id,
      actorId: null,
    });
    await repository.assignLabel({
      projectId,
      evaluatorId,
      label: "production",
      versionId: second.id,
      actorId: null,
    });
    const labels = await repository.findLabels({ projectId, ids: [evaluatorId] });
    expect(labels.map((row) => [row.label, row.version])).toEqual([["production", 2]]);

    expect(await repository.removeLabel({ projectId, evaluatorId, label: "production" })).toBe(
      true,
    );
    expect(await repository.removeLabel({ projectId, evaluatorId, label: "production" })).toBe(
      false,
    );
    expect(
      (await repository.findVersion({ projectId, evaluatorId, version: 1 }))?.config,
    ).toMatchObject(configAt(1));
    expect(
      (await repository.latestVersionNumbers({ projectId, ids: [evaluatorId] })).get(evaluatorId),
    ).toBe(2);
  });

  /** @scenario "Existing evaluators get version 1 from their current settings" */
  it("backfills version 1 for an evaluator written before versions existed, once", async () => {
    const oldId = `${namespace}-old`;
    await connection.client.evaluator.create({
      data: {
        id: oldId,
        projectId,
        name: "Old judge",
        slug: `${namespace}-old`,
        type: "evaluator",
        config: configAt(7),
      },
    });

    const page = await repository.findUnversioned({ afterId: null, limit: 10_000 });
    const old = page.find((row) => row.id === oldId);
    expect(old).toBeDefined();
    expect(await repository.backfillFirstVersion({ evaluator: old!, createdById: null })).toBe(
      true,
    );
    expect(await repository.backfillFirstVersion({ evaluator: old!, createdById: null })).toBe(
      false,
    );
    const versions = await repository.findVersions({ projectId, evaluatorId: oldId });
    expect(versions.map((row) => row.version)).toEqual([1]);
  });

  /** @scenario "A legacy evaluator's first save keeps its old settings as version 1" */
  it("records the pre-version settings as version 1 before the first save", async () => {
    const legacyId = `${namespace}-legacy`;
    await connection.client.evaluator.create({
      data: {
        id: legacyId,
        projectId,
        name: "Legacy judge",
        slug: `${namespace}-legacy`,
        type: "evaluator",
        config: configAt(3),
      },
    });

    await repository.update({ id: legacyId, projectId, data: { config: configAt(4) }, author });

    const versions = await repository.findVersions({ projectId, evaluatorId: legacyId });
    expect(versions.map((row) => [row.version, row.config])).toEqual([
      [2, configAt(4)],
      [1, configAt(3)],
    ]);
  });
});
