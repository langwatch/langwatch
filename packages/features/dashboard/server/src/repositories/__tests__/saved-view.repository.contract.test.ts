/**
 * @vitest-environment node
 * The saved-view contract, stated once and run against both backends: the
 * memory twin always, and the Postgres one when a test database is named at
 * `LANGWATCH_TEST_DATABASE_URL`.
 * @see specs/dashboard-service.feature
 * @see specs/saved-views.feature
 */
import {
  PrismaConfigService,
  PrismaConnectionService,
  PrismaQueryGuard,
  type PrismaQueryContext,
  type PrismaQueryExecutor,
} from "@langwatch/prisma-client";
import type { PrismaClient } from "@langwatch/prisma-client/generated";
import { cleanupTestRows } from "@langwatch/test-harness";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { MemorySavedViewRepository } from "../memory/memory.saved-view.repository.ts";
import { PrismaSavedViewRepository } from "../prisma/prisma.saved-view.repository.ts";
import type { CreateSavedViewInput, SavedViewRepository } from "../saved-view.repository.ts";

/**
 * One backend under test: a clean repository, and the two project ids the
 * isolation cases read against.
 */
type Backend = Readonly<{
  repository: () => SavedViewRepository;
  projectId: () => string;
  otherProjectId: () => string;
  userId: () => string;
}>;

const V2_KIND = "v2-traces-lens";

function view(overrides: Partial<CreateSavedViewInput> & { id: string }): CreateSavedViewInput {
  return {
    projectId: "project-1",
    name: "Failures",
    filters: { status: "error" },
    order: 0,
    ...overrides,
  };
}

function contractCases(backend: Backend): void {
  const seed = (overrides: Partial<CreateSavedViewInput> & { id: string }) =>
    view({ projectId: backend.projectId(), ...overrides });

  describe("when the project has no saved views", () => {
    /** @scenario "The memory and Postgres dashboard repositories answer alike" */
    it("answers absence with undefined rather than a refusal", async () => {
      const repository = backend.repository();

      await expect(
        repository.findById({ id: "view_absent", projectId: backend.projectId() }),
      ).resolves.toBeUndefined();
      await expect(
        repository.findLast({ projectId: backend.projectId() }),
      ).resolves.toBeUndefined();
    });

    it("lists nothing and counts nothing", async () => {
      const repository = backend.repository();

      await expect(repository.findAll({ projectId: backend.projectId() })).resolves.toEqual([]);
      await expect(repository.count({ projectId: backend.projectId() })).resolves.toBe(0);
      await expect(
        repository.findByIds({ ids: ["view_absent"], projectId: backend.projectId() }),
      ).resolves.toEqual([]);
    });

    it("refuses to update or delete a row it does not hold", async () => {
      const repository = backend.repository();

      await expect(
        repository.update({
          id: "view_absent",
          projectId: backend.projectId(),
          data: { name: "Renamed" },
        }),
      ).rejects.toThrow();
      await expect(
        repository.delete({ id: "view_absent", projectId: backend.projectId() }),
      ).rejects.toThrow();
    });
  });

  describe("when views are written", () => {
    it("reads a created view back by its id", async () => {
      const repository = backend.repository();
      const created = await repository.create(seed({ id: `view_${randomUUID()}` }));

      expect(created).toMatchObject({
        projectId: backend.projectId(),
        name: "Failures",
        userId: null,
        query: null,
        period: null,
        order: 0,
        kind: "v1-traces-filter",
      });
      await expect(
        repository.findById({ id: created.id, projectId: backend.projectId() }),
      ).resolves.toMatchObject({ id: created.id, name: "Failures" });
    });

    it("lists them by order and counts the same rows", async () => {
      const repository = backend.repository();
      const second = `view_${randomUUID()}`;
      const first = `view_${randomUUID()}`;
      await repository.create(seed({ id: second, name: "Second", order: 1 }));
      await repository.create(seed({ id: first, name: "First", order: 0 }));

      const listed = await repository.findAll({ projectId: backend.projectId() });

      expect(listed.map((row) => row.name)).toEqual(["First", "Second"]);
      await expect(repository.count({ projectId: backend.projectId() })).resolves.toBe(2);
    });

    it("answers the last view by order, which is where the next one is appended", async () => {
      const repository = backend.repository();
      await repository.create(seed({ id: `view_${randomUUID()}`, order: 0 }));
      const last = await repository.create(seed({ id: `view_${randomUUID()}`, order: 4 }));

      await expect(repository.findLast({ projectId: backend.projectId() })).resolves.toMatchObject({
        id: last.id,
      });
    });

    it("writes many at once and skips an id it already holds", async () => {
      const repository = backend.repository();
      const id = `view_${randomUUID()}`;
      await repository.create(seed({ id, name: "Original" }));
      await repository.createMany({
        views: [
          seed({ id, name: "Duplicate" }),
          seed({ id: `view_${randomUUID()}`, name: "Fresh", order: 1 }),
        ],
      });

      const listed = await repository.findAll({ projectId: backend.projectId() });

      expect(listed.map((row) => row.name)).toEqual(["Original", "Fresh"]);
    });

    it("names who owns each of the ids it was asked about", async () => {
      const repository = backend.repository();
      const shared = await repository.create(seed({ id: `view_${randomUUID()}` }));
      const personal = await repository.create(
        seed({ id: `view_${randomUUID()}`, userId: backend.userId(), order: 1 }),
      );

      const owners = await repository.findByIds({
        ids: [shared.id, personal.id, "view_absent"],
        projectId: backend.projectId(),
      });

      expect(owners).toHaveLength(2);
      expect(owners).toEqual(
        expect.arrayContaining([
          { id: shared.id, userId: null },
          { id: personal.id, userId: backend.userId() },
        ]),
      );
    });

    it("edits the fields it was given and leaves the rest alone", async () => {
      const repository = backend.repository();
      const created = await repository.create(seed({ id: `view_${randomUUID()}` }));

      const updated = await repository.update({
        id: created.id,
        projectId: backend.projectId(),
        data: { name: "Renamed", query: "status:error" },
      });

      expect(updated).toMatchObject({
        id: created.id,
        name: "Renamed",
        query: "status:error",
        filters: { status: "error" },
      });
    });

    it("renumbers the views in the order it was handed", async () => {
      const repository = backend.repository();
      const first = await repository.create(seed({ id: `view_${randomUUID()}`, order: 0 }));
      const second = await repository.create(seed({ id: `view_${randomUUID()}`, order: 1 }));

      await repository.updateOrder({
        projectId: backend.projectId(),
        viewIds: [second.id, first.id],
      });

      const listed = await repository.findAll({ projectId: backend.projectId() });

      expect(listed.map((row) => row.id)).toEqual([second.id, first.id]);
    });

    it("hands back the row it deleted and then answers absence", async () => {
      const repository = backend.repository();
      const created = await repository.create(seed({ id: `view_${randomUUID()}` }));

      const deleted = await repository.delete({ id: created.id, projectId: backend.projectId() });

      expect(deleted).toMatchObject({ id: created.id });
      await expect(
        repository.findById({ id: created.id, projectId: backend.projectId() }),
      ).resolves.toBeUndefined();
    });
  });

  describe("when the two storage kinds share the table", () => {
    it("answers each client with only its own kind", async () => {
      const repository = backend.repository();
      await repository.create(seed({ id: `view_${randomUUID()}`, name: "Legacy" }));
      await repository.create(
        seed({ id: `view_${randomUUID()}`, name: "Lens", kind: V2_KIND, order: 1 }),
      );

      const lenses = await repository.findAll({ projectId: backend.projectId(), kind: V2_KIND });

      expect(lenses.map((row) => row.name)).toEqual(["Lens"]);
      await expect(
        repository.count({ projectId: backend.projectId(), kind: V2_KIND }),
      ).resolves.toBe(1);
      await expect(
        repository.findLast({ projectId: backend.projectId(), kind: V2_KIND }),
      ).resolves.toMatchObject({ name: "Lens" });
    });
  });

  describe("when a view belongs to somebody else", () => {
    it("shows a member the project's own views and their own, and nobody else's", async () => {
      const repository = backend.repository();
      await repository.create(seed({ id: `view_${randomUUID()}`, name: "Shared" }));
      await repository.create(
        seed({ id: `view_${randomUUID()}`, name: "Mine", userId: backend.userId(), order: 1 }),
      );

      const visible = await repository.findAll({
        projectId: backend.projectId(),
        userId: backend.userId(),
      });

      expect(visible.map((row) => row.name)).toEqual(["Shared", "Mine"]);
      await expect(
        repository.count({ projectId: backend.projectId(), userId: backend.userId() }),
      ).resolves.toBe(2);
    });
  });

  describe("when another project holds views of its own", () => {
    it("never reads, counts or edits a row belonging to that project", async () => {
      const repository = backend.repository();
      const foreign = await repository.create(
        view({ id: `view_${randomUUID()}`, projectId: backend.otherProjectId(), name: "Theirs" }),
      );

      await expect(
        repository.findById({ id: foreign.id, projectId: backend.projectId() }),
      ).resolves.toBeUndefined();
      await expect(repository.findAll({ projectId: backend.projectId() })).resolves.toEqual([]);
      await expect(repository.count({ projectId: backend.projectId() })).resolves.toBe(0);
      await expect(
        repository.findByIds({ ids: [foreign.id], projectId: backend.projectId() }),
      ).resolves.toEqual([]);
      await expect(
        repository.update({
          id: foreign.id,
          projectId: backend.projectId(),
          data: { name: "Stolen" },
        }),
      ).rejects.toThrow();
      await expect(
        repository.delete({ id: foreign.id, projectId: backend.projectId() }),
      ).rejects.toThrow();
      await expect(
        repository.findById({ id: foreign.id, projectId: backend.otherProjectId() }),
      ).resolves.toMatchObject({ name: "Theirs" });
    });
  });
}

describe("given the memory saved view repository", () => {
  let repository: SavedViewRepository;

  beforeEach(() => {
    repository = MemorySavedViewRepository.create();
  });

  contractCases({
    repository: () => repository,
    projectId: () => "project-1",
    otherProjectId: () => "project-2",
    userId: () => "user-1",
  });
});

class AllowTestQueries extends PrismaQueryGuard {
  execute(context: PrismaQueryContext, next: PrismaQueryExecutor): Promise<unknown> {
    return next(context.args);
  }
}

const databaseUrl = process.env.LANGWATCH_TEST_DATABASE_URL;
const connection = databaseUrl
  ? PrismaConnectionService.create({ guard: new AllowTestQueries() }).connect(
      PrismaConfigService.create().resolve({ databaseUrl, log: ["error"] }),
    )
  : null;

function database(): PrismaClient {
  if (connection === null) throw new Error("LANGWATCH_TEST_DATABASE_URL is required here");
  return connection.client;
}

describe.skipIf(!databaseUrl)("given the Postgres saved view repository", () => {
  const namespace = `saved-view-contract-${randomUUID()}`;
  let projectId = "";
  let otherProjectId = "";
  let userId = "";

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
    userId = (
      await database().user.create({
        data: { name: namespace, email: `${namespace}@example.com` },
        select: { id: true },
      })
    ).id;
  });

  beforeEach(async () => {
    await cleanupTestRows(database(), [
      ["savedView", { projectId }],
      ["savedView", { projectId: otherProjectId }],
    ]);
  });

  afterAll(async () => {
    await cleanupTestRows(database(), [
      ["savedView", { projectId }],
      ["savedView", { projectId: otherProjectId }],
      ["project", { id: { in: [projectId, otherProjectId] } }],
      ["user", { id: userId }],
      ["team", { slug: namespace }],
      ["organization", { slug: namespace }],
    ]);
  });

  contractCases({
    repository: () => PrismaSavedViewRepository.create({ prisma: database() }),
    projectId: () => projectId,
    otherProjectId: () => otherProjectId,
    userId: () => userId,
  });
});
