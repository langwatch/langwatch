/**
 * @vitest-environment node
 * The privacy-rule contract, stated once and run against both backends: the
 * memory twin always, and the Postgres one when a test database is named at
 * `LANGWATCH_TEST_DATABASE_URL`. The datastore lane
 * (`vitest.integration.config.ts`) is where both halves run together.
 *
 * The rules table is keyed by organization, so the isolation case here is the
 * organization: a rule another organization wrote is never answered with.
 * @see specs/data-privacy-service.feature
 */
import type {
  DataPrivacyConfig,
  DataPrivacyScope,
} from "@langwatch/data-privacy-contract";
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

import type { DataPrivacyPolicyRepository } from "../data-privacy.repository.ts";
import { MemoryDataPrivacyPolicyRepository } from "../memory/memory.data-privacy.repository.ts";
import { PrismaDataPrivacyPolicyRepository } from "../prisma/prisma.data-privacy.repository.ts";

/**
 * One backend under test. The namespace keeps a run's organization and scope
 * ids off every other row in a shared database: the stored unique key is
 * (scopeType, scopeId, personalOnly) across all organizations, so a fixed
 * scope id would collide with whatever else is in there.
 */
type Backend = Readonly<{ repository: () => DataPrivacyPolicyRepository; namespace: () => string }>;

const DROP_INPUT: DataPrivacyConfig = { categories: { input: { disposition: "drop" } } };
const CAPTURE_INPUT: DataPrivacyConfig = { categories: { input: { disposition: "capture" } } };

function contractCases(backend: Backend): void {
  const acme = () => `org_acme_${backend.namespace()}`;
  const other = () => `org_other_${backend.namespace()}`;
  const team = (): DataPrivacyScope => ({
    scopeType: "TEAM",
    scopeId: `team_${backend.namespace()}`,
  });
  const project = (): DataPrivacyScope => ({
    scopeType: "PROJECT",
    scopeId: `project_${backend.namespace()}`,
  });

  describe("when the organization has written no rule", () => {
    /** @scenario "The memory and Postgres privacy rule repositories answer alike" */
    it("answers a scope chain with no rows", async () => {
      const repository = backend.repository();

      await expect(
        repository.findForProjectChain({
          organizationId: acme(),
          scopes: [{ ...project(), personalOnly: false }],
        }),
      ).resolves.toEqual([]);
    });

    it("lists nothing for the organization", async () => {
      const repository = backend.repository();

      await expect(
        repository.findAllInOrganization({ organizationId: acme() }),
      ).resolves.toEqual([]);
    });

    it("deletes a rule nobody wrote without complaint", async () => {
      const repository = backend.repository();

      await expect(
        repository.deleteForScope({
          organizationId: acme(),
          scope: team(),
          personalOnly: false,
        }),
      ).resolves.toBeUndefined();
    });
  });

  describe("when a rule is written for a scope", () => {
    it("reads the rule back on the scope's chain", async () => {
      const repository = backend.repository();

      await repository.upsertForScope({
        organizationId: acme(),
        scope: team(),
        personalOnly: false,
        config: DROP_INPUT,
      });

      await expect(
        repository.findForProjectChain({
          organizationId: acme(),
          scopes: [
            { ...team(), personalOnly: false },
            { ...project(), personalOnly: false },
          ],
        }),
      ).resolves.toEqual([{ ...team(), personalOnly: false, config: DROP_INPUT }]);
    });

    it("lists the rule with the organization that wrote it", async () => {
      const repository = backend.repository();

      const written = await repository.upsertForScope({
        organizationId: acme(),
        scope: team(),
        personalOnly: false,
        config: DROP_INPUT,
      });

      expect(written).toMatchObject({
        organizationId: acme(),
        ...team(),
        personalOnly: false,
      });
      await expect(repository.findAllInOrganization({ organizationId: acme() })).resolves.toEqual([
        written,
      ]);
    });

    it("rewrites the same rule rather than adding a second one", async () => {
      const repository = backend.repository();

      const first = await repository.upsertForScope({
        organizationId: acme(),
        scope: team(),
        personalOnly: false,
        config: DROP_INPUT,
      });
      const second = await repository.upsertForScope({
        organizationId: acme(),
        scope: team(),
        personalOnly: false,
        config: CAPTURE_INPUT,
      });

      expect(second.id).toBe(first.id);
      expect(second.config).toEqual(CAPTURE_INPUT);
      await expect(
        repository.findAllInOrganization({ organizationId: acme() }),
      ).resolves.toHaveLength(1);
    });

    it("keeps the personal-only rule apart from the shared one on the same scope", async () => {
      const repository = backend.repository();

      await repository.upsertForScope({
        organizationId: acme(),
        scope: team(),
        personalOnly: false,
        config: DROP_INPUT,
      });
      await repository.upsertForScope({
        organizationId: acme(),
        scope: team(),
        personalOnly: true,
        config: CAPTURE_INPUT,
      });

      const listed = await repository.findAllInOrganization({ organizationId: acme() });

      expect(listed).toHaveLength(2);
      expect(listed.map((row) => row.personalOnly).sort()).toEqual([false, true]);
    });

    it("removes only the rule it was asked to remove", async () => {
      const repository = backend.repository();

      await repository.upsertForScope({
        organizationId: acme(),
        scope: team(),
        personalOnly: false,
        config: DROP_INPUT,
      });
      await repository.upsertForScope({
        organizationId: acme(),
        scope: project(),
        personalOnly: false,
        config: DROP_INPUT,
      });

      await repository.deleteForScope({
        organizationId: acme(),
        scope: team(),
        personalOnly: false,
      });

      const listed = await repository.findAllInOrganization({ organizationId: acme() });

      expect(listed).toHaveLength(1);
      expect(listed[0]).toMatchObject(project());
    });
  });

  describe("when another organization holds a rule on the same scope", () => {
    it("never answers a chain with the other organization's rule", async () => {
      const repository = backend.repository();

      await repository.upsertForScope({
        organizationId: other(),
        scope: team(),
        personalOnly: false,
        config: DROP_INPUT,
      });

      await expect(
        repository.findForProjectChain({
          organizationId: acme(),
          scopes: [{ ...team(), personalOnly: false }],
        }),
      ).resolves.toEqual([]);
    });

    it("never lists the other organization's rule", async () => {
      const repository = backend.repository();

      await repository.upsertForScope({
        organizationId: other(),
        scope: team(),
        personalOnly: false,
        config: DROP_INPUT,
      });

      await expect(
        repository.findAllInOrganization({ organizationId: acme() }),
      ).resolves.toEqual([]);
    });

    it("never deletes the other organization's rule", async () => {
      const repository = backend.repository();

      await repository.upsertForScope({
        organizationId: other(),
        scope: team(),
        personalOnly: false,
        config: DROP_INPUT,
      });

      await repository.deleteForScope({
        organizationId: acme(),
        scope: team(),
        personalOnly: false,
      });

      await expect(
        repository.findAllInOrganization({ organizationId: other() }),
      ).resolves.toHaveLength(1);
    });
  });
}

describe("given the memory data privacy repository", () => {
  let repository: DataPrivacyPolicyRepository;

  beforeEach(() => {
    repository = MemoryDataPrivacyPolicyRepository.create();
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

describe.skipIf(!databaseUrl)("given the Postgres data privacy repository", () => {
  const namespace = randomUUID();
  const clean = () =>
    cleanupTestRows(database(), [
      ["dataPrivacyPolicy", { organizationId: { in: [`org_acme_${namespace}`, `org_other_${namespace}`] } }],
    ]);

  beforeEach(clean);
  afterAll(clean);

  contractCases({
    repository: () => PrismaDataPrivacyPolicyRepository.create({ prisma: database() }),
    namespace: () => namespace,
  });
});
