/**
 * @vitest-environment node
 * The operator-row contract, stated once and run against both backends: the
 * memory twin always, and the Postgres one when a test database is named at
 * `LANGWATCH_TEST_DATABASE_URL`. The datastore lane
 * (`vitest.integration.config.ts`) is where both halves run together.
 *
 * The FeatureFlag table is cluster-wide and `findAll` reads all of it, so the
 * cases narrow the listing to this run's own keys: in a shared database the
 * rows an installation already carries are not this suite's to reason about.
 * @see specs/feature-flag.feature
 */
import type { FeatureFlagRules } from "@langwatch/feature-flag-contract";
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

import type { FeatureFlagRepository } from "../feature-flag.repository.ts";
import { MemoryFeatureFlagRepository } from "../memory/memory.feature-flag.repository.ts";
import { PrismaFeatureFlagRepository } from "../prisma/prisma.feature-flag.repository.ts";

/** One backend under test, with the key prefix its rows are written under. */
type Backend = Readonly<{ repository: () => FeatureFlagRepository; prefix: () => string }>;

const RULES: FeatureFlagRules = [{ match: { organizationId: "org_acme" }, enabled: true }];

function contractCases(backend: Backend): void {
  const flagA = () => `${backend.prefix()}_release_a`;
  const flagB = () => `${backend.prefix()}_release_b`;
  const absent = () => `${backend.prefix()}_release_absent`;
  const ours = async (repository: FeatureFlagRepository) =>
    (await repository.findAll()).filter((row) => row.key.startsWith(backend.prefix()));

  describe("when no row exists for the key", () => {
    /** @scenario "The memory and Postgres feature flag repositories answer alike" */
    it("answers absence with null rather than a refusal", async () => {
      const repository = backend.repository();

      await expect(repository.findByKey(absent())).resolves.toBeNull();
    });

    it("lists none of its own rows", async () => {
      const repository = backend.repository();

      await expect(ours(repository)).resolves.toEqual([]);
    });

    it("deletes a key nobody wrote without complaint", async () => {
      const repository = backend.repository();

      await expect(repository.deleteByKey(absent())).resolves.toBeUndefined();
    });
  });

  describe("when an operator writes the enabled flag", () => {
    it("reads the written value back", async () => {
      const repository = backend.repository();

      await repository.upsertEnabled({
        key: flagA(),
        enabled: true,
        lastEditedBy: "user_olive",
      });

      await expect(repository.findByKey(flagA())).resolves.toEqual({
        enabled: true,
        rules: [],
      });
    });

    it("keeps the targeting rules the row already carried", async () => {
      const repository = backend.repository();

      await repository.upsertRules({
        key: flagA(),
        rules: RULES,
        seedEnabled: false,
        lastEditedBy: "user_olive",
      });
      await repository.upsertEnabled({
        key: flagA(),
        enabled: true,
        lastEditedBy: "user_pat",
      });

      await expect(repository.findByKey(flagA())).resolves.toEqual({
        enabled: true,
        rules: RULES,
      });
    });
  });

  describe("when an operator writes targeting rules", () => {
    it("seeds the row-level value on the first write", async () => {
      const repository = backend.repository();

      await repository.upsertRules({
        key: flagA(),
        rules: RULES,
        seedEnabled: true,
        lastEditedBy: null,
      });

      await expect(repository.findByKey(flagA())).resolves.toEqual({
        enabled: true,
        rules: RULES,
      });
    });

    it("leaves an existing row-level value alone", async () => {
      const repository = backend.repository();

      await repository.upsertEnabled({ key: flagA(), enabled: false, lastEditedBy: null });
      await repository.upsertRules({
        key: flagA(),
        rules: RULES,
        seedEnabled: true,
        lastEditedBy: null,
      });

      await expect(repository.findByKey(flagA())).resolves.toMatchObject({ enabled: false });
    });
  });

  describe("when several rows exist", () => {
    it("lists every row ordered by key", async () => {
      const repository = backend.repository();

      await repository.upsertEnabled({ key: flagB(), enabled: true, lastEditedBy: "user_pat" });
      await repository.upsertEnabled({ key: flagA(), enabled: false, lastEditedBy: null });

      const listed = await ours(repository);

      expect(listed.map((row) => row.key)).toEqual([flagA(), flagB()]);
      expect(listed[0]).toMatchObject({ enabled: false, rules: [], lastEditedBy: null });
      expect(listed[1]).toMatchObject({ enabled: true, lastEditedBy: "user_pat" });
    });

    it("removes only the key it was asked to remove", async () => {
      const repository = backend.repository();

      await repository.upsertEnabled({ key: flagA(), enabled: true, lastEditedBy: null });
      await repository.upsertEnabled({ key: flagB(), enabled: true, lastEditedBy: null });

      await repository.deleteByKey(flagA());

      await expect(repository.findByKey(flagA())).resolves.toBeNull();
      await expect(repository.findByKey(flagB())).resolves.not.toBeNull();
    });
  });
}

describe("given the memory feature flag repository", () => {
  let repository: FeatureFlagRepository;

  beforeEach(() => {
    repository = MemoryFeatureFlagRepository.create();
  });

  contractCases({ repository: () => repository, prefix: () => "memory" });
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

describe.skipIf(!databaseUrl)("given the Postgres feature flag repository", () => {
  const prefix = `contract_${randomUUID().replaceAll("-", "")}`;
  const clean = () => cleanupTestRows(database(), [["featureFlag", { key: { startsWith: prefix } }]]);

  beforeEach(clean);
  afterAll(clean);

  contractCases({
    repository: () => PrismaFeatureFlagRepository.create({ prisma: database() }),
    prefix: () => prefix,
  });
});
