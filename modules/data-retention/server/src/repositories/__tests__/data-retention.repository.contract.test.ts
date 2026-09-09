/**
 * @vitest-environment node
 * The retention-policy contract, stated once and run against both backends:
 * the memory twin always, and the Postgres one when a test database is named
 * at `LANGWATCH_TEST_DATABASE_URL`. The datastore lane
 * (`vitest.integration.config.ts`) is where both halves run together.
 *
 * The policy table is keyed by organization, so the isolation case here is the
 * organization: a policy another organization wrote is never answered with.
 * @see specs/data-retention-service.feature
 */
import type { ScopeAssignment } from "@langwatch/data-retention-contract";
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
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import type { DataRetentionRepository } from "../data-retention.repository.ts";
import { MemoryDataRetentionRepository } from "../memory/memory.data-retention.repository.ts";
import { PrismaDataRetentionRepository } from "../prisma/prisma.data-retention.repository.ts";

/**
 * One backend under test. The namespace keeps a run's organization and scope
 * ids off every other row in a shared database: the stored unique key is
 * (scopeType, scopeId, category) across all organizations, so a fixed scope id
 * would collide with whatever else is in there.
 */
type Backend = Readonly<{ repository: () => DataRetentionRepository; namespace: () => string }>;

function contractCases(backend: Backend): void {
  const acme = () => `org_acme_${backend.namespace()}`;
  const other = () => `org_other_${backend.namespace()}`;
  const team = (): ScopeAssignment => ({
    scopeType: "TEAM",
    scopeId: `team_${backend.namespace()}`,
  });
  const project = (): ScopeAssignment => ({
    scopeType: "PROJECT",
    scopeId: `project_${backend.namespace()}`,
  });

  describe("when the organization has written no policy", () => {
    /** @scenario "The memory and Postgres data retention repositories answer alike" */
    it("answers a scope chain with no rows", async () => {
      const repository = backend.repository();

      await expect(
        repository.findForProjectChain({ organizationId: acme(), scopes: [project()] }),
      ).resolves.toEqual([]);
    });

    it("lists nothing for the organization", async () => {
      const repository = backend.repository();

      await expect(
        repository.findAllInOrganization({ organizationId: acme() }),
      ).resolves.toEqual([]);
    });

    it("deletes a policy nobody wrote without complaint", async () => {
      const repository = backend.repository();

      await expect(
        repository.deleteForScope({ scope: team(), category: "traces" }),
      ).resolves.toBeUndefined();
    });
  });

  describe("when a policy is written for a scope", () => {
    it("reads the policy back on the scope's chain", async () => {
      const repository = backend.repository();

      await repository.upsertForScope({
        organizationId: acme(),
        scope: team(),
        category: "traces",
        retentionDays: 35,
      });

      await expect(
        repository.findForProjectChain({ organizationId: acme(), scopes: [team(), project()] }),
      ).resolves.toEqual([{ ...team(), category: "traces", retentionDays: 35 }]);
    });

    it("lists the policy with the organization that wrote it", async () => {
      const repository = backend.repository();

      const written = await repository.upsertForScope({
        organizationId: acme(),
        scope: team(),
        category: "traces",
        retentionDays: 35,
      });

      expect(written).toMatchObject({
        organizationId: acme(),
        ...team(),
        retentionDays: 35,
      });
      await expect(repository.findAllInOrganization({ organizationId: acme() })).resolves.toEqual([
        written,
      ]);
    });

    it("rewrites the same policy rather than adding a second one", async () => {
      const repository = backend.repository();

      const first = await repository.upsertForScope({
        organizationId: acme(),
        scope: team(),
        category: "traces",
        retentionDays: 35,
      });
      const second = await repository.upsertForScope({
        organizationId: acme(),
        scope: team(),
        category: "traces",
        retentionDays: 63,
      });

      expect(second.id).toBe(first.id);
      expect(second.retentionDays).toBe(63);
      await expect(
        repository.findAllInOrganization({ organizationId: acme() }),
      ).resolves.toHaveLength(1);
    });

    it("keeps one scope's categories apart from each other", async () => {
      const repository = backend.repository();

      await repository.upsertForScope({
        organizationId: acme(),
        scope: team(),
        category: "traces",
        retentionDays: 35,
      });
      await repository.upsertForScope({
        organizationId: acme(),
        scope: team(),
        category: "scenarios",
        retentionDays: 63,
      });

      const listed = await repository.findAllInOrganization({ organizationId: acme() });

      expect(listed).toHaveLength(2);
      expect(listed.map((row) => row.category).sort()).toEqual(["scenarios", "traces"]);
    });

    it("removes only the category it was asked to remove", async () => {
      const repository = backend.repository();

      await repository.upsertForScope({
        organizationId: acme(),
        scope: team(),
        category: "traces",
        retentionDays: 35,
      });
      await repository.upsertForScope({
        organizationId: acme(),
        scope: team(),
        category: "scenarios",
        retentionDays: 63,
      });

      await repository.deleteForScope({ scope: team(), category: "traces" });

      const listed = await repository.findAllInOrganization({ organizationId: acme() });

      expect(listed).toHaveLength(1);
      expect(listed[0]).toMatchObject({ category: "scenarios" });
    });
  });

  describe("when another organization holds a policy on a scope of its own", () => {
    it("never answers a chain with the other organization's policy", async () => {
      const repository = backend.repository();

      await repository.upsertForScope({
        organizationId: other(),
        scope: team(),
        category: "traces",
        retentionDays: 35,
      });

      await expect(
        repository.findForProjectChain({ organizationId: acme(), scopes: [team()] }),
      ).resolves.toEqual([]);
    });

    it("never lists the other organization's policy", async () => {
      const repository = backend.repository();

      await repository.upsertForScope({
        organizationId: other(),
        scope: team(),
        category: "traces",
        retentionDays: 35,
      });

      await expect(
        repository.findAllInOrganization({ organizationId: acme() }),
      ).resolves.toEqual([]);
    });
  });
}

describe("given the memory data retention repository", () => {
  let repository: DataRetentionRepository;

  beforeEach(() => {
    repository = MemoryDataRetentionRepository.create();
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
  ? PrismaConnectionService.create({ guard: new AllowTestQueries() }).connect(
      PrismaConfigService.create().resolve({ databaseUrl, log: ["error"] }),
    )
  : null;

function database(): PrismaClient {
  if (connection === null) throw new Error("LANGWATCH_TEST_DATABASE_URL is required here");
  return connection.client;
}

describe.skipIf(!databaseUrl)("given the Postgres data retention repository", () => {
  const namespace = randomUUID();
  const clean = () =>
    cleanupTestRows(database(), [
      [
        "retentionPolicy",
        { organizationId: { in: [`org_acme_${namespace}`, `org_other_${namespace}`] } },
      ],
    ]);

  beforeEach(clean);
  afterAll(clean);

  contractCases({
    repository: () => PrismaDataRetentionRepository.create({ prisma: database() }),
    namespace: () => namespace,
  });
});
