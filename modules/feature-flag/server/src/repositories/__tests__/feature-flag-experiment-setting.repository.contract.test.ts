/**
 * @vitest-environment node
 * The experiment-setting contract, stated once and run against both backends:
 * the memory twin always, and the Postgres one when a test database is named
 * at `LANGWATCH_TEST_DATABASE_URL`. The datastore lane
 * (`vitest.integration.config.ts`) is where both halves run together.
 *
 * Every read names its flags and its subjects, so a run's own prefix is all
 * the isolation the cases need in a shared database.
 * @see specs/feature-flag.feature
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
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import type {
  ExperimentSubject,
  FeatureFlagExperimentRepository,
} from "../feature-flag-experiment-setting.repository.ts";
import { MemoryFeatureFlagExperimentRepository } from "../memory/memory.feature-flag-experiment-setting.repository.ts";
import { PrismaFeatureFlagExperimentSettingRepository } from "../prisma/prisma.feature-flag-experiment-setting.repository.ts";

/** One backend under test, with the prefix its flags and subjects are named under. */
type Backend = Readonly<{
  repository: () => FeatureFlagExperimentRepository;
  prefix: () => string;
}>;

function contractCases(backend: Backend): void {
  const flagA = () => `${backend.prefix()}_release_a`;
  const flagB = () => `${backend.prefix()}_release_b`;
  const olive = (): ExperimentSubject => ({
    subjectType: "USER",
    subjectId: `${backend.prefix()}_olive`,
  });
  const pat = (): ExperimentSubject => ({
    subjectType: "USER",
    subjectId: `${backend.prefix()}_pat`,
  });
  const acme = (): ExperimentSubject => ({
    subjectType: "ORGANIZATION",
    subjectId: `${backend.prefix()}_acme`,
  });

  describe("when nobody has enrolled", () => {
    /** @scenario "The memory and Postgres feature flag repositories answer alike" */
    it("answers absence with no settings at all", async () => {
      const repository = backend.repository();

      await expect(
        repository.findForSubjects({ flagKeys: [flagA()], subjects: [olive()] }),
      ).resolves.toEqual([]);
    });

    it("removes a setting nobody wrote without complaint", async () => {
      const repository = backend.repository();

      await expect(
        repository.remove({ flagKey: flagA(), ...olive() }),
      ).resolves.toBeUndefined();
    });
  });

  describe("when a person has enrolled", () => {
    it("reads their own setting back", async () => {
      const repository = backend.repository();

      await repository.upsert({
        flagKey: flagA(),
        ...olive(),
        enabled: true,
        changedByUserId: null,
      });

      await expect(
        repository.findForSubjects({ flagKeys: [flagA()], subjects: [olive()] }),
      ).resolves.toEqual([{ flagKey: flagA(), ...olive(), enabled: true }]);
    });

    it("replaces the setting rather than adding a second one", async () => {
      const repository = backend.repository();

      await repository.upsert({
        flagKey: flagA(),
        ...olive(),
        enabled: true,
        changedByUserId: null,
      });
      await repository.upsert({
        flagKey: flagA(),
        ...olive(),
        enabled: false,
        changedByUserId: null,
      });

      await expect(
        repository.findForSubjects({ flagKeys: [flagA()], subjects: [olive()] }),
      ).resolves.toEqual([{ flagKey: flagA(), ...olive(), enabled: false }]);
    });

    it("returns the setting to inherit when it is removed", async () => {
      const repository = backend.repository();

      await repository.upsert({
        flagKey: flagA(),
        ...acme(),
        enabled: true,
        changedByUserId: null,
      });
      await repository.remove({ flagKey: flagA(), ...acme() });

      await expect(
        repository.findForSubjects({ flagKeys: [flagA()], subjects: [acme()] }),
      ).resolves.toEqual([]);
    });
  });

  describe("when settings belong to other subjects and other flags", () => {
    it("never answers with a setting the caller did not name", async () => {
      const repository = backend.repository();

      await repository.upsert({
        flagKey: flagA(),
        ...olive(),
        enabled: true,
        changedByUserId: null,
      });
      await repository.upsert({
        flagKey: flagA(),
        ...pat(),
        enabled: true,
        changedByUserId: null,
      });
      await repository.upsert({
        flagKey: flagB(),
        ...olive(),
        enabled: true,
        changedByUserId: null,
      });

      // A subject id is only ever read beside its type: an organization and a
      // person who happen to share an id are two different subjects.
      await repository.upsert({
        flagKey: flagA(),
        subjectType: "ORGANIZATION",
        subjectId: olive().subjectId,
        enabled: false,
        changedByUserId: null,
      });

      await expect(
        repository.findForSubjects({ flagKeys: [flagA()], subjects: [olive()] }),
      ).resolves.toEqual([{ flagKey: flagA(), ...olive(), enabled: true }]);
    });

    it("answers every named flag for every named subject in one read", async () => {
      const repository = backend.repository();

      await repository.upsert({
        flagKey: flagA(),
        ...olive(),
        enabled: true,
        changedByUserId: null,
      });
      await repository.upsert({
        flagKey: flagB(),
        ...acme(),
        enabled: false,
        changedByUserId: null,
      });

      const settings = await repository.findForSubjects({
        flagKeys: [flagA(), flagB()],
        subjects: [olive(), acme()],
      });

      expect(settings).toHaveLength(2);
      expect(settings).toEqual(
        expect.arrayContaining([
          { flagKey: flagA(), ...olive(), enabled: true },
          { flagKey: flagB(), ...acme(), enabled: false },
        ]),
      );
    });

    it("answers nothing when no flag or no subject is named", async () => {
      const repository = backend.repository();

      await repository.upsert({
        flagKey: flagA(),
        ...olive(),
        enabled: true,
        changedByUserId: null,
      });

      await expect(
        repository.findForSubjects({ flagKeys: [], subjects: [olive()] }),
      ).resolves.toEqual([]);
      await expect(
        repository.findForSubjects({ flagKeys: [flagA()], subjects: [] }),
      ).resolves.toEqual([]);
    });
  });
}

describe("given the memory experiment setting repository", () => {
  let repository: FeatureFlagExperimentRepository;

  beforeEach(() => {
    repository = MemoryFeatureFlagExperimentRepository.create();
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

describe.skipIf(!databaseUrl)("given the Postgres experiment setting repository", () => {
  const prefix = `contract_${randomUUID().replaceAll("-", "")}`;
  const clean = () =>
    cleanupTestRows(database(), [
      ["featureFlagExperimentSetting", { flagKey: { startsWith: prefix } }],
    ]);

  beforeEach(clean);
  afterAll(clean);

  contractCases({
    repository: () => PrismaFeatureFlagExperimentSettingRepository.create({ prisma: database() }),
    prefix: () => prefix,
  });
});
