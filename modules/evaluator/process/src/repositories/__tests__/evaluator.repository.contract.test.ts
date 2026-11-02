import { randomUUID } from "node:crypto";

import { EvaluatorVersionNotFoundError, type Evaluator } from "@langwatch/evaluator-contract";
import { createLogger } from "@langwatch/observability";
/**
 * @vitest-environment node
 * The evaluator-row contract, run against both backends: the memory
 * twin always, and Postgres when `LANGWATCH_TEST_DATABASE_URL` names a
 * test database. Both run together in the datastore lane.
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
import { cleanupTestRows } from "@langwatch/test-harness/prisma";
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
  /** Writes a row as a release before versions did: no version, no creator. */
  seedUnversioned: (input: { id: string; name: string }) => Promise<Evaluator>;
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
      const slug = created.slug ?? "";

      expect(created).toMatchObject({
        id: backend.id("a"),
        projectId: backend.projectId(),
        name: "Exact match",
        type: "evaluator",
        archivedAt: null,
      });
      expect(slug).toMatch(/^exact-match-[a-z0-9]{5}$/);

      await expect(
        backend.repository().findById({ id: created.id, projectId: backend.projectId() }),
      ).resolves.toMatchObject({ id: created.id, slug });
      await expect(
        backend.repository().findBySlug({ slug, projectId: backend.projectId() }),
      ).resolves.toMatchObject({ id: created.id });
    });

    it("keeps a name that carries no slug characters addressable", async () => {
      const created = await create({ name: "!!!" });

      expect(created.slug).toMatch(/^[a-z0-9]{5}$/);
    });

    it("gives two evaluators that share a name distinct slugs, each addressable", async () => {
      const first = await create({ id: backend.id("dup-1"), name: "Same name" });
      const second = await create({ id: backend.id("dup-2"), name: "Same name" });

      expect(second.slug).not.toBe(first.slug);
      await expect(
        backend
          .repository()
          .findBySlug({ slug: second.slug ?? "", projectId: backend.projectId() }),
      ).resolves.toMatchObject({ id: second.id });
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
      const other = await backend.repository().create({
        id: backend.id("b"),
        projectId: backend.otherProjectId(),
        name: "Exact match",
        type: "evaluator",
        config: { evaluatorType: "langevals/exact_match" },
      });

      await expect(
        backend.repository().findBySlug({ slug: other.slug ?? "", projectId: backend.projectId() }),
      ).resolves.toBeUndefined();
      await expect(
        backend.repository().findAll({ projectId: backend.projectId() }),
      ).resolves.toEqual([]);
    });
  });

  describe("when an evaluator is updated twice", () => {
    const updateTo = (input: { id: string; name: string }) =>
      backend.repository().update({
        id: input.id,
        projectId: backend.projectId(),
        data: { name: input.name },
        commitMessage: `renamed to ${input.name}`,
      });

    it("lists its versions newest first and reads the newest without a number", async () => {
      const created = await create();
      await updateTo({ id: created.id, name: "Second" });
      await updateTo({ id: created.id, name: "Third" });
      const lookup = { projectId: backend.projectId(), evaluatorId: created.id };

      const versions = await backend.repository().findVersions(lookup);

      expect(versions.map((version) => version.version)).toEqual([3, 2, 1]);
      await expect(backend.repository().findVersion(lookup)).resolves.toMatchObject({
        version: 3,
        name: "Third",
      });
      await expect(
        backend.repository().findVersion({ ...lookup, version: 1 }),
      ).resolves.toMatchObject({ name: "Exact match", commitMessage: null });
      await expect(
        backend.repository().findVersion({ ...lookup, versionId: versions[1]?.id }),
      ).resolves.toMatchObject({ version: 2, commitMessage: "renamed to Second" });
      await expect(
        backend
          .repository()
          .latestVersionNumbers({ projectId: backend.projectId(), ids: [created.id] }),
      ).resolves.toEqual(new Map([[created.id, 3]]));
    });

    it("answers no version of it to another project", async () => {
      const created = await create();

      await expect(
        backend
          .repository()
          .findVersion({ projectId: backend.otherProjectId(), evaluatorId: created.id }),
      ).resolves.toBeUndefined();
      await expect(
        backend.repository().findVersions({
          projectId: backend.otherProjectId(),
          evaluatorId: created.id,
        }),
      ).resolves.toEqual([]);
    });
  });

  describe("when an update changes nothing a version holds", () => {
    it("appends no version and answers the row as it is stored", async () => {
      const created = await create();

      const updated = await backend.repository().update({
        id: created.id,
        projectId: backend.projectId(),
        data: { name: created.name },
      });

      await expect(
        backend
          .repository()
          .findVersions({ projectId: backend.projectId(), evaluatorId: created.id }),
      ).resolves.toHaveLength(1);
      const stored = await backend
        .repository()
        .findById({ id: created.id, projectId: backend.projectId() });
      expect(stored?.updatedAt.getTime()).toBe(updated.updatedAt.getTime());
      expect(updated.updatedAt.getTime()).toBeGreaterThanOrEqual(created.updatedAt.getTime());
    });
  });

  describe("when a deploy label is assigned", () => {
    it("moves between versions, reads back by evaluator and is removed once", async () => {
      const created = await create();
      await backend.repository().update({
        id: created.id,
        projectId: backend.projectId(),
        data: { name: "Second" },
      });
      const [second, first] = await backend
        .repository()
        .findVersions({ projectId: backend.projectId(), evaluatorId: created.id });
      const assign = (versionId: string) =>
        backend.repository().assignLabel({
          projectId: backend.projectId(),
          evaluatorId: created.id,
          label: "production",
          versionId,
          actorId: null,
        });
      const labels = () =>
        backend.repository().findLabels({ projectId: backend.projectId(), ids: [created.id] });

      await expect(assign(first?.id ?? "")).resolves.toMatchObject({ version: 1 });
      await expect(assign(second?.id ?? "")).resolves.toMatchObject({ version: 2 });
      await expect(labels()).resolves.toEqual([
        expect.objectContaining({ label: "production", version: 2, versionId: second?.id }),
      ]);

      const remove = () =>
        backend.repository().removeLabel({
          projectId: backend.projectId(),
          evaluatorId: created.id,
          label: "production",
        });
      await expect(remove()).resolves.toBe(true);
      await expect(remove()).resolves.toBe(false);
      await expect(labels()).resolves.toEqual([]);
    });

    it("refuses a version the evaluator does not hold", async () => {
      const created = await create();

      await expect(
        backend.repository().assignLabel({
          projectId: backend.projectId(),
          evaluatorId: created.id,
          label: "production",
          versionId: "evaluatorversion_unknown",
          actorId: null,
        }),
      ).rejects.toBeInstanceOf(EvaluatorVersionNotFoundError);
    });
  });

  describe("when the backfill reaches an evaluator", () => {
    it("writes no version 1 for an evaluator that already has one", async () => {
      const created = await create();

      await expect(
        backend.repository().backfillFirstVersion({ evaluator: created, createdById: null }),
      ).resolves.toBe(false);
    });

    it("writes version 1 from the row of an unversioned evaluator, once", async () => {
      const seeded = await backend.seedUnversioned({ id: backend.id("old"), name: "Older" });

      await expect(
        backend.repository().backfillFirstVersion({ evaluator: seeded, createdById: null }),
      ).resolves.toBe(true);
      await expect(
        backend.repository().backfillFirstVersion({ evaluator: seeded, createdById: null }),
      ).resolves.toBe(false);
      await expect(
        backend
          .repository()
          .findVersions({ projectId: backend.projectId(), evaluatorId: seeded.id }),
      ).resolves.toEqual([
        expect.objectContaining({ version: 1, name: "Older", authorKind: "system" }),
      ]);
    });
  });
}

describe("given the memory evaluator repository", () => {
  let repository: MemoryEvaluatorRepository;

  beforeEach(() => {
    repository = MemoryEvaluatorRepository.create();
  });

  contractCases({
    repository: () => repository,
    projectId: () => "project_1",
    otherProjectId: () => "project_2",
    id: (suffix) => `evaluator_${suffix}`,
    seedUnversioned: async ({ id, name }) => {
      const at = new Date();
      const row: Evaluator = {
        id,
        projectId: "project_1",
        name,
        slug: `${id}-slug`,
        type: "evaluator",
        config: { evaluatorType: "langevals/exact_match" },
        workflowId: null,
        copiedFromEvaluatorId: null,
        archivedAt: null,
        createdAt: at,
        updatedAt: at,
        createdById: null,
        updatedById: null,
      };
      repository.seedUnversioned(row);
      return row;
    },
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
    }).connect(PrismaConfigService.create().resolve({ databaseUrl, log: ["error"] }))
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
      // Copies first: relation emulation refuses to delete a source a copy still names.
      [
        "evaluator",
        { projectId: { in: [projectId, otherProjectId] }, copiedFromEvaluatorId: { not: null } },
      ],
      ["evaluatorVersionLabel", { projectId: { in: [projectId, otherProjectId] } }],
      ["evaluatorVersion", { projectId: { in: [projectId, otherProjectId] } }],
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
    seedUnversioned: async ({ id, name }) => {
      await database().evaluator.create({
        data: {
          id,
          projectId,
          name,
          slug: `${id}-slug`,
          type: "evaluator",
          config: { evaluatorType: "langevals/exact_match" },
        },
      });
      const row = await repository.findById({ id, projectId });
      if (!row) throw new Error(`Seeded evaluator ${id} did not read back`);
      return row;
    },
  });
});
