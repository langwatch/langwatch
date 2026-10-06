import { randomUUID } from "node:crypto";

/**
 * @vitest-environment node
 * Project-scope fold contract test: memory and Postgres answer alike, newer-wins per column
 * group. Spec: modules/data-privacy/specs/data-privacy-resolution-seam.feature
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
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import type { DataPrivacyProjectScopeRepository } from "../data-privacy-project-scope.repository.ts";
import { MemoryDataPrivacyProjectScopeRepository } from "../memory/memory.data-privacy-project-scope.repository.ts";
import { PrismaDataPrivacyProjectScopeRepository } from "../prisma/prisma.data-privacy-project-scope.repository.ts";

type Backend = Readonly<{
  repository: () => DataPrivacyProjectScopeRepository;
  namespace: () => string;
}>;

function contractCases(backend: Backend): void {
  const key = () => ({
    projectId: `project_${backend.namespace()}`,
    organizationId: `org_${backend.namespace()}`,
  });

  it("knows no project it has folded nothing for", async () => {
    await expect(backend.repository().find({ projectId: key().projectId })).resolves.toBeNull();
  });

  it("keeps the newer team and department whatever order the facts arrive in", async () => {
    const repository = backend.repository();
    await repository.recordTeam({ ...key(), teamId: "beta", recordedAtMs: 20 });
    await repository.recordTeam({ ...key(), teamId: "alpha", isPersonal: false, recordedAtMs: 10 });
    await repository.recordDepartment({ ...key(), departmentId: "risk", recordedAtMs: 10 });
    await repository.recordDepartment({ ...key(), departmentId: "ops", recordedAtMs: 5 });

    await expect(repository.find({ projectId: key().projectId })).resolves.toEqual({
      ...key(),
      teamId: "beta",
      isPersonal: false,
      departmentId: "risk",
      archived: false,
    });
  });

  it("stays archived once archived", async () => {
    const repository = backend.repository();
    await repository.recordArchived({ ...key(), archivedAtMs: 30 });
    await repository.recordArchived({ ...key(), archivedAtMs: 40 });
    await repository.recordTeam({ ...key(), teamId: "gamma", recordedAtMs: 50 });

    await expect(repository.find({ projectId: key().projectId })).resolves.toMatchObject({
      teamId: "gamma",
      archived: true,
    });
  });
}

describe("given the memory project-scope repository", () => {
  let repository: DataPrivacyProjectScopeRepository;
  beforeEach(() => {
    repository = MemoryDataPrivacyProjectScopeRepository.create();
  });

  contractCases({ repository: () => repository, namespace: () => "memory" });
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

describe.skipIf(!databaseUrl)("given the Postgres project-scope repository", () => {
  const namespace = randomUUID();
  const clean = () =>
    cleanupTestRows(database(), [
      ["dataPrivacyProjectScope", { projectId: `project_${namespace}` }],
    ]);

  beforeEach(clean);
  afterAll(clean);

  contractCases({
    repository: () => PrismaDataPrivacyProjectScopeRepository.create({ prisma: database() }),
    namespace: () => namespace,
  });
});
