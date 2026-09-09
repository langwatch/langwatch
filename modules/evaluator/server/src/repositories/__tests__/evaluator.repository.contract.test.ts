/**
 * @vitest-environment node
 * The evaluator-row contract, stated once and run against both backends: the
 * memory twin always, and the Postgres one when a test database is named at
 * `LANGWATCH_TEST_DATABASE_URL`. The datastore lane
 * (`vitest.integration.config.ts`) is where both halves run together.
 * @see specs/evaluators/evaluator-management.feature
 */
import {
  PrismaConfigService,
  PrismaConnectionService,
  PrismaQueryGuard,
  type PrismaQueryContext,
  type PrismaQueryExecutor,
} from "@langwatch/prisma-client";
import type { PrismaClient } from "@langwatch/prisma-client/generated";
import { createLogger } from "@langwatch/observability";
import { cleanupTestRows } from "@langwatch/test-harness";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import type { EvaluatorRepository } from "../evaluator.repository.ts";
import { MemoryEvaluatorRepository } from "../memory/memory.evaluator.repository.ts";
import { PrismaEvaluatorRepository } from "../prisma/prisma.evaluator.repository.ts";

/** One backend under test. Postgres needs real project rows behind the ids. */
type Backend = Readonly<{
  repository: () => EvaluatorRepository;
  projectId: () => string;
  otherProjectId: () => string;
  id: (suffix: string) => string;
}>;

function contractCases(backend: Backend): void {
  const create = (overrides: Partial<Parameters<EvaluatorRepository["create"]>[0]> = {}) =>
    backend.repository().create({
      id: backend.id("a"),
      projectId: backend.projectId(),
      name: "Exact match",
      type: "evaluator",
      config: { evaluatorType: "langevals/exact_match" },
      ...overrides,
    });

  describe("when the project holds no evaluator", () => {
    /** @scenario "The memory and Postgres evaluator repositories answer alike" */
    it("answers absence with undefined rather than a refusal", async () => {
      const repository = backend.repository();

      await expect(
        repository.findById({ id: backend.id("a"), projectId: backend.projectId() }),
      ).resolves.toBeUndefined();
      await expect(
        repository.findBySlug({ slug: "exact-match", projectId: backend.projectId() }),
      ).resolves.toBeUndefined();
      await expect(
        repository.findByWorkflow({ workflowId: "wf_1", projectId: backend.projectId() }),
      ).resolves.toBeUndefined();
      await expect(repository.findAll({ projectId: backend.projectId() })).resolves.toEqual([]);
    });
  });

  describe("when an evaluator is created", () => {
    it("derives a slug from the name and reads the row back by id and by slug", async () => {
      const created = await create();

      expect(created).toMatchObject({
        id: backend.id("a"),
        projectId: backend.projectId(),
        name: "Exact match",
        slug: "exact-match",
        type: "evaluator",
        archivedAt: null,
      });

      await expect(
        backend.repository().findById({ id: created.id, projectId: backend.projectId() }),
      ).resolves.toMatchObject({ id: created.id, slug: "exact-match" });
      await expect(
        backend.repository().findBySlug({ slug: "exact-match", projectId: backend.projectId() }),
      ).resolves.toMatchObject({ id: created.id });
    });

    it("keeps a name that carries no slug characters addressable", async () => {
      const created = await create({ name: "!!!" });

      expect(created.slug).toBe("evaluator");
    });

    it("finds a workflow evaluator by the workflow it backs", async () => {
      const created = await create({ type: "workflow", workflowId: "wf_1" });

      await expect(
        backend.repository().findByWorkflow({ workflowId: "wf_1", projectId: backend.projectId() }),
      ).resolves.toMatchObject({ id: created.id });
    });
  });

  describe("when an evaluator is updated", () => {
    it("writes the named fields and leaves the rest as they were", async () => {
      const created = await create();

      const updated = await backend.repository().update({
        id: created.id,
        projectId: backend.projectId(),
        data: { name: "Renamed", config: { evaluatorType: "langevals/exact_match", cased: true } },
      });

      expect(updated).toMatchObject({ name: "Renamed", slug: created.slug, type: "evaluator" });
      expect(updated.config).toMatchObject({ cased: true });
    });

    it("pushes a name and config onto a replica without answering a row", async () => {
      const created = await create();

      await expect(
        backend.repository().updateNameAndConfig({
          id: created.id,
          projectId: backend.projectId(),
          name: "Pushed",
          config: { evaluatorType: "langevals/exact_match" },
        }),
      ).resolves.toBeUndefined();
      await expect(
        backend.repository().findById({ id: created.id, projectId: backend.projectId() }),
      ).resolves.toMatchObject({ name: "Pushed" });
    });
  });

  describe("when an evaluator is archived", () => {
    it("stamps the row and hides it from every read", async () => {
      const created = await create();

      const archived = await backend
        .repository()
        .archive({ id: created.id, projectId: backend.projectId() });

      expect(archived.archivedAt).not.toBeNull();
      await expect(
        backend.repository().findById({ id: created.id, projectId: backend.projectId() }),
      ).resolves.toBeUndefined();
      await expect(
        backend.repository().findAll({ projectId: backend.projectId() }),
      ).resolves.toEqual([]);
      await expect(
        backend.repository().findByIdAcrossProjects(created.id),
      ).resolves.toBeUndefined();
    });
  });

  describe("when a copy sits in another project", () => {
    it("lists the copy and reads its source across the project boundary", async () => {
      const source = await create();
      const copy = await backend.repository().create({
        id: backend.id("b"),
        projectId: backend.otherProjectId(),
        name: "Exact match",
        type: "evaluator",
        config: { evaluatorType: "langevals/exact_match" },
        copiedFromEvaluatorId: source.id,
      });

      const copies = await backend.repository().findCopies({ evaluatorId: source.id });

      expect(copies).toHaveLength(1);
      expect(copies[0]).toMatchObject({
        id: copy.id,
        name: "Exact match",
        projectId: backend.otherProjectId(),
      });
      expect(copies[0]?.fullPath).toContain("/");
      await expect(backend.repository().findByIdAcrossProjects(source.id)).resolves.toMatchObject({
        id: source.id,
      });
    });
  });

  describe("when another project holds an evaluator of the same slug", () => {
    it("never answers with the other project's row", async () => {
      await backend.repository().create({
        id: backend.id("b"),
        projectId: backend.otherProjectId(),
        name: "Exact match",
        type: "evaluator",
        config: { evaluatorType: "langevals/exact_match" },
      });

      await expect(
        backend.repository().findBySlug({ slug: "exact-match", projectId: backend.projectId() }),
      ).resolves.toBeUndefined();
      await expect(
        backend.repository().findAll({ projectId: backend.projectId() }),
      ).resolves.toEqual([]);
    });
  });
}

describe("given the memory evaluator repository", () => {
  let repository: EvaluatorRepository;

  beforeEach(() => {
    repository = MemoryEvaluatorRepository.create();
  });

  contractCases({
    repository: () => repository,
    projectId: () => "project_1",
    otherProjectId: () => "project_2",
    id: (suffix) => `evaluator_${suffix}`,
  });
});

class AllowTestQueries extends PrismaQueryGuard {
  execute(context: PrismaQueryContext, next: PrismaQueryExecutor): Promise<unknown> {
    return next(context.args);
  }
}

const databaseUrl = process.env.LANGWATCH_TEST_DATABASE_URL;
const connection = databaseUrl
  ? PrismaConnectionService.create({
      guard: new AllowTestQueries(),
      logger: createLogger("langwatch:test:evaluator-repository"),
    }).connect(
      PrismaConfigService.create().resolve({ databaseUrl, log: ["error"] }),
    )
  : null;

function database(): PrismaClient {
  if (connection === null) throw new Error("LANGWATCH_TEST_DATABASE_URL is required here");

  return connection.client;
}

describe.skipIf(!databaseUrl)("given the Postgres evaluator repository", () => {
  const namespace = `evaluator-contract-${randomUUID()}`;
  let repository: EvaluatorRepository;
  let projectId = "";
  let otherProjectId = "";

  const clean = () =>
    cleanupTestRows(database(), [
      ["evaluator", { projectId: { in: [projectId, otherProjectId] } }],
    ]);

  beforeAll(async () => {
    const organization = await database().organization.create({
      data: { name: namespace, slug: namespace },
    });
    const team = await database().team.create({
      data: { name: namespace, slug: namespace, organizationId: organization.id },
    });
    const project = (slug: string) =>
      database().project.create({
        data: {
          name: slug,
          slug,
          apiKey: slug,
          teamId: team.id,
          language: "typescript",
          framework: "other",
        },
        select: { id: true },
      });

    projectId = (await project(`${namespace}-a`)).id;
    otherProjectId = (await project(`${namespace}-b`)).id;
    repository = PrismaEvaluatorRepository.create({ prisma: database() });
  });

  beforeEach(clean);

  afterAll(async () => {
    await clean();
    await connection?.client.$disconnect();
  });

  contractCases({
    repository: () => repository,
    projectId: () => projectId,
    otherProjectId: () => otherProjectId,
    id: (suffix) => `evaluator_${namespace}_${suffix}`,
  });
});
