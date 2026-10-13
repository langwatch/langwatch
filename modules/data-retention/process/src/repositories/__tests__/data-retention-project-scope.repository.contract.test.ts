import { randomUUID } from "node:crypto";

/**
 * @vitest-environment node
 * Placement read contract: the memory twin always, and Postgres over project's and organization's
 * rows when `LANGWATCH_TEST_DATABASE_URL` names a test database.
 * Spec: modules/data-retention/specs/data-retention-project-scope.feature
 */
import { createLogger } from "@langwatch/observability";
import {
  PrismaConfigService,
  PrismaConnectionService,
  PrismaQueryGuard,
  type PrismaQueryContext,
  type PrismaQueryExecutor,
} from "@langwatch/prisma-client";
import type { PrismaClient } from "@langwatch/prisma-client/generated";
import { cleanupTestRows } from "@langwatch/test-harness/prisma";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { DataRetentionProjectScopeRepository } from "../data-retention-project-scope.repository.ts";
import { MemoryDataRetentionProjectScopeRepository } from "../memory/memory.data-retention-project-scope.repository.ts";
import { PrismaDataRetentionProjectScopeRepository } from "../prisma/prisma.data-retention-project-scope.repository.ts";

/** One organisation: a team with a live and an archived project, and an empty team. */
type Seeded = Readonly<{
  organizationId: string;
  teamId: string;
  emptyTeamId: string;
  liveProjectId: string;
  archivedProjectId: string;
}>;

type Backend = Readonly<{
  seeded: () => Seeded;
  repository: () => DataRetentionProjectScopeRepository;
}>;

function contractCases(backend: Backend): void {
  /** @scenario "The memory and Postgres placement readers answer alike" */
  it("answers placements, archived projects included, and knows no project or team without a row", async () => {
    const seeded = backend.seeded();
    const repository = backend.repository();
    const { organizationId, teamId } = seeded;

    await expect(
      repository.findProjectPlacement({ projectId: seeded.liveProjectId }),
    ).resolves.toEqual({ projectId: seeded.liveProjectId, organizationId, teamId });
    await expect(repository.findTeamOrganizationId({ teamId: seeded.emptyTeamId })).resolves.toBe(
      organizationId,
    );
    await expect(
      repository.findProjectIds({ organizationId }).then((ids) => ids.toSorted()),
    ).resolves.toEqual([seeded.archivedProjectId, seeded.liveProjectId].toSorted());
    await expect(
      repository.findProjectIds({ organizationId, teamId: seeded.emptyTeamId }),
    ).resolves.toEqual([]);
    await expect(
      repository.findProjectPlacement({ projectId: `project-without-row-${randomUUID()}` }),
    ).resolves.toBeNull();
    await expect(
      repository.findTeamOrganizationId({ teamId: `team-without-row-${randomUUID()}` }),
    ).resolves.toBeNull();
  });

  /** @scenario "An archived project keeps its place, so its stored data still expires" */
  it("places an archived project under its team and organisation", async () => {
    const seeded = backend.seeded();

    await expect(
      backend.repository().findProjectPlacement({ projectId: seeded.archivedProjectId }),
    ).resolves.toEqual({
      projectId: seeded.archivedProjectId,
      organizationId: seeded.organizationId,
      teamId: seeded.teamId,
    });
  });
}

describe("given the memory placement reader", () => {
  const seeded: Seeded = {
    organizationId: "organization-1",
    teamId: "team-1",
    emptyTeamId: "team-empty",
    liveProjectId: "project-live",
    archivedProjectId: "project-archived",
  };
  const repository = MemoryDataRetentionProjectScopeRepository.create({
    projects: [seeded.liveProjectId, seeded.archivedProjectId].map((projectId) => ({
      projectId,
      organizationId: seeded.organizationId,
      teamId: seeded.teamId,
    })),
    teams: [{ teamId: seeded.emptyTeamId, organizationId: seeded.organizationId }],
  });

  contractCases({ seeded: () => seeded, repository: () => repository });
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
      logger: createLogger("data-retention-test"),
    }).connect(PrismaConfigService.create().resolve({ databaseUrl, log: ["error"] }))
  : null;

function database(): PrismaClient {
  if (connection === null) throw new Error("LANGWATCH_TEST_DATABASE_URL is required here");
  return connection.client;
}

async function createProject({
  teamId,
  slug,
  archived,
}: {
  teamId: string;
  slug: string;
  archived: boolean;
}): Promise<string> {
  const project = await database().project.create({
    data: {
      name: slug,
      slug,
      apiKey: `key-${slug}`,
      teamId,
      language: "python",
      framework: "openai",
      ...(archived ? { archivedAt: new Date() } : {}),
    },
  });
  return project.id;
}

describe.skipIf(!databaseUrl)("given the Postgres placement reader", () => {
  const ns = randomUUID();
  let seeded: Seeded | undefined;

  beforeAll(async () => {
    const organizationId = (
      await database().organization.create({ data: { name: `Org ${ns}`, slug: `org-${ns}` } })
    ).id;
    const team = (slug: string) =>
      database().team.create({ data: { name: slug, slug, organizationId } });
    const teamId = (await team(`team-${ns}`)).id;
    const emptyTeamId = (await team(`team-empty-${ns}`)).id;
    seeded = {
      organizationId,
      teamId,
      emptyTeamId,
      liveProjectId: await createProject({ teamId, slug: `live-${ns}`, archived: false }),
      archivedProjectId: await createProject({ teamId, slug: `archived-${ns}`, archived: true }),
    };
  });

  afterAll(async () => {
    if (!seeded) return;
    await cleanupTestRows(database(), [
      ["project", { id: { in: [seeded.liveProjectId, seeded.archivedProjectId] } }],
      ["team", { id: { in: [seeded.teamId, seeded.emptyTeamId] } }],
      ["organization", { id: seeded.organizationId }],
    ]);
  });

  contractCases({
    seeded: () => {
      if (!seeded) throw new Error("the Postgres rows were not seeded");
      return seeded;
    },
    repository: () => PrismaDataRetentionProjectScopeRepository.create(database()),
  });
});
