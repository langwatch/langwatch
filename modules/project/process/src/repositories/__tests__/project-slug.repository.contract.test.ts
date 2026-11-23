/**
 * @vitest-environment node
 * `findSlugHolders` and `replaceSlug` answer alike on memory and Postgres: who holds a slug, and a
 * move that ends moved, gone or taken. The reserved-slug step relies on all three.
 * @see modules/dashboard/specs/dashboards-organization-area.feature
 */
import {
  PrismaConfigService,
  PrismaConnectionService,
  PrismaShutdownService,
  PrismaTenancyGuardService,
} from "@langwatch/prisma-client";
import type { PrismaClient } from "@langwatch/prisma-client/generated";
import { createTestLogger } from "@langwatch/test-harness";
import { fromDate } from "@langwatch/time";
import { nanoid } from "nanoid";
import { afterAll, describe, expect, it } from "vitest";

import { MemoryProjectDatabase } from "../memory/memory.project.database.ts";
import { MemoryProjectRepository } from "../memory/memory.project.repository.ts";
import { PrismaProjectRepository } from "../prisma/prisma.project.repository.ts";
import type { ProjectRepository } from "../project.repository.ts";

type SlugBackend = {
  repository: Pick<ProjectRepository, "findSlugHolders" | "replaceSlug">;
  /** Makes a project holding `slug`; answers its id. */
  holding: (slug: string) => Promise<string>;
  slugOf: (projectId: string) => Promise<string | undefined>;
};

function contractCases(backend: () => SlugBackend): void {
  const ns = nanoid(8).toLowerCase();
  const slug = (name: string) => `${name}-${ns}`;

  describe("when a slug is looked up", () => {
    it("names the project holding exactly it, and nobody for a slug no one holds", async () => {
      const { repository, holding } = backend();
      const id = await holding(slug("held"));

      await expect(repository.findSlugHolders({ slug: slug("held") })).resolves.toEqual([
        expect.objectContaining({ id, slug: slug("held") }),
      ]);
      await expect(repository.findSlugHolders({ slug: slug("free") })).resolves.toEqual([]);
    });
  });

  describe("when a project still holds the slug it moves from", () => {
    it("moves it to a free slug", async () => {
      const { repository, holding, slugOf } = backend();
      const projectId = await holding(slug("from"));

      const move = await repository.replaceSlug({
        projectId,
        from: slug("from"),
        to: slug("to"),
      });

      expect(move).toBe("moved");
      expect(await slugOf(projectId)).toBe(slug("to"));
    });
  });

  describe("when the project no longer holds the slug it moves from", () => {
    it("answers gone and changes nothing", async () => {
      const { repository, holding, slugOf } = backend();
      const projectId = await holding(slug("current"));

      const move = await repository.replaceSlug({
        projectId,
        from: slug("stale"),
        to: slug("elsewhere"),
      });

      expect(move).toBe("gone");
      expect(await slugOf(projectId)).toBe(slug("current"));
    });
  });

  describe("when another project holds the slug it moves to", () => {
    it("answers taken and changes neither", async () => {
      const { repository, holding, slugOf } = backend();
      const projectId = await holding(slug("mover"));
      const other = await holding(slug("taken"));

      const move = await repository.replaceSlug({
        projectId,
        from: slug("mover"),
        to: slug("taken"),
      });

      expect(move).toBe("taken");
      expect(await slugOf(projectId)).toBe(slug("mover"));
      expect(await slugOf(other)).toBe(slug("taken"));
    });
  });
}

function memoryBackend(): SlugBackend {
  const database = MemoryProjectDatabase.create();
  database.putOrganization({
    id: "organization_1",
    name: "Acme",
    presenceEnabled: true,
    traceSharingEnabled: true,
    adminUserIds: [],
    onboardingVariant: null,
    createdAt: fromDate(new Date("2026-01-01T00:00:00.000Z")),
  });
  database.putTeam({
    id: "team_1",
    name: "Core",
    slug: "core",
    organizationId: "organization_1",
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-01T00:00:00.000Z"),
    archivedAt: null,
    isPersonal: false,
    ownerUserId: null,
    departmentId: null,
  });
  const repository = MemoryProjectRepository.create({ memory: database });
  return {
    repository,
    holding: async (slug) => {
      const id = `project_${nanoid(6)}`;
      const project = { id, slug, teamId: "team_1", name: slug, apiKey: `sk-${id}` };
      await repository.create({ ...project, language: "python", framework: "openai" });
      return id;
    },
    slugOf: async (projectId) => database.findProject(projectId)?.slug,
  };
}

describe("given the memory project repository", () => {
  contractCases(memoryBackend);
});

const DB_URL = process.env.LANGWATCH_TEST_DATABASE_URL;
// Built only with a test database, so a run without one opens no pool.
const connection = DB_URL
  ? PrismaConnectionService.create({
      guard: PrismaTenancyGuardService.create(),
      logger: createTestLogger().logger,
    }).connect(PrismaConfigService.create().resolve({ databaseUrl: DB_URL, log: ["error"] }))
  : null;

describe.skipIf(connection === null)("given the Postgres project repository", () => {
  const ns = `project-slug-${nanoid(8)}`.toLowerCase();
  const prisma = connection?.client as PrismaClient;
  const repository = PrismaProjectRepository.create({ prisma });
  const made = { organization: "", team: "", projects: [] as string[] };

  const teamId = async () => {
    if (made.team) return made.team;
    const organization = await prisma.organization.create({
      data: { name: `Org ${ns}`, slug: `org-${ns}` },
    });
    made.organization = organization.id;
    const team = await prisma.team.create({
      data: { name: `Team ${ns}`, slug: `team-${ns}`, organizationId: organization.id },
    });
    made.team = team.id;
    return team.id;
  };

  afterAll(async () => {
    await prisma.project.deleteMany({ where: { id: { in: made.projects } } });
    await prisma.team.deleteMany({ where: { id: made.team } });
    await prisma.organization.deleteMany({ where: { id: made.organization } });
    if (connection) await PrismaShutdownService.create().shutdown(connection);
  });

  contractCases(() => ({
    repository,
    holding: async (slug) => {
      const base = { teamId: await teamId(), language: "python", framework: "openai" };
      const project = await prisma.project.create({
        data: { ...base, name: slug, slug, apiKey: `key-${slug}` },
      });
      made.projects.push(project.id);
      return project.id;
    },
    slugOf: async (projectId) =>
      (await prisma.project.findUnique({ where: { id: projectId } }))?.slug,
  }));
});
