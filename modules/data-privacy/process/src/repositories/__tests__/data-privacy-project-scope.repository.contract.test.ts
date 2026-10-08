import { randomUUID } from "node:crypto";

/**
 * @vitest-environment node
 * Placement read contract: the memory twin always, and Postgres over project's and organization's
 * rows when `LANGWATCH_TEST_DATABASE_URL` is set. Spec: data-privacy-resolution-seam.feature
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

import type { DataPrivacyProjectScopeRepository } from "../data-privacy-project-scope.repository.ts";
import { MemoryDataPrivacyProjectScopeRepository } from "../memory/memory.data-privacy-project-scope.repository.ts";
import { PrismaDataPrivacyProjectScopeRepository } from "../prisma/prisma.data-privacy-project-scope.repository.ts";

/** One organisation's team with a live project in a department and an archived one. */
type Seeded = Readonly<{
  organizationId: string;
  teamId: string;
  departmentId: string;
  liveProjectId: string;
  archivedProjectId: string;
}>;

type Backend = Readonly<{
  seeded: () => Seeded;
  repository: () => DataPrivacyProjectScopeRepository;
}>;

function contractCases(backend: Backend): void {
  /** @scenario "The memory and Postgres placement readers answer alike" */
  it("answers team, organisation, department and archive state, and no project without a row", async () => {
    const seeded = backend.seeded();
    const repository = backend.repository();
    const placed = { organizationId: seeded.organizationId, teamId: seeded.teamId };

    await expect(repository.find({ projectId: seeded.liveProjectId })).resolves.toEqual({
      ...placed,
      projectId: seeded.liveProjectId,
      isPersonal: false,
      departmentId: seeded.departmentId,
      archived: false,
    });
    await expect(repository.find({ projectId: seeded.archivedProjectId })).resolves.toEqual({
      ...placed,
      projectId: seeded.archivedProjectId,
      isPersonal: false,
      departmentId: null,
      archived: true,
    });
    await expect(
      repository.find({ projectId: `project-without-row-${randomUUID()}` }),
    ).resolves.toBeNull();
  });
}

describe("given the memory placement reader", () => {
  const seeded: Seeded = {
    organizationId: "organization-1",
    teamId: "team-1",
    departmentId: "department-risk",
    liveProjectId: "project-live",
    archivedProjectId: "project-archived",
  };
  const placed = {
    organizationId: seeded.organizationId,
    teamId: seeded.teamId,
    isPersonal: false,
  };
  const repository = MemoryDataPrivacyProjectScopeRepository.create({
    projects: [
      {
        ...placed,
        projectId: seeded.liveProjectId,
        departmentId: seeded.departmentId,
        archived: false,
      },
      { ...placed, projectId: seeded.archivedProjectId, departmentId: null, archived: true },
    ],
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
      logger: createLogger("data-privacy-test"),
    }).connect(PrismaConfigService.create().resolve({ databaseUrl, log: ["error"] }))
  : null;

function database(): PrismaClient {
  if (connection === null) throw new Error("LANGWATCH_TEST_DATABASE_URL is required here");
  return connection.client;
}

async function createProject({
  teamId,
  slug,
  departmentId,
  archived,
}: {
  teamId: string;
  slug: string;
  departmentId: string | null;
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
      departmentId,
      ...(archived ? { archivedAt: new Date() } : {}),
    },
  });
  return project.id;
}

describe.skipIf(!databaseUrl)("given the Postgres placement reader", () => {
  const ns = randomUUID();
  const departmentId = `department-${ns}`;
  let seeded: Seeded | undefined;

  beforeAll(async () => {
    const organizationId = (
      await database().organization.create({ data: { name: `Org ${ns}`, slug: `org-${ns}` } })
    ).id;
    const teamId = (
      await database().team.create({
        data: { name: `team-${ns}`, slug: `team-${ns}`, organizationId },
      })
    ).id;
    seeded = {
      organizationId,
      teamId,
      departmentId,
      liveProjectId: await createProject({
        teamId,
        slug: `live-${ns}`,
        departmentId,
        archived: false,
      }),
      archivedProjectId: await createProject({
        teamId,
        slug: `archived-${ns}`,
        departmentId: null,
        archived: true,
      }),
    };
  });

  afterAll(async () => {
    if (!seeded) return;
    await cleanupTestRows(database(), [
      ["project", { id: { in: [seeded.liveProjectId, seeded.archivedProjectId] } }],
      ["team", { id: seeded.teamId }],
      ["organization", { id: seeded.organizationId }],
    ]);
  });

  contractCases({
    seeded: () => {
      if (!seeded) throw new Error("the Postgres rows were not seeded");
      return seeded;
    },
    repository: () => PrismaDataPrivacyProjectScopeRepository.create(database()),
  });
});
