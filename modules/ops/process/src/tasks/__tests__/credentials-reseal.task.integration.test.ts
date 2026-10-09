/**
 * @vitest-environment node
 * The credentials-reseal walk over real Postgres rows: a text column and a JSON
 * column sealed under the previous key, and one value sealed under neither key.
 * @see specs/self-hosting/credentials-secret-rotation.feature
 */
import { randomBytes } from "node:crypto";

import {
  PrismaConfigService,
  PrismaConnectionService,
  PrismaShutdownService,
  PrismaTenancyGuardService,
  type PrismaConnection,
} from "@langwatch/prisma-client";
import type { PrismaClient } from "@langwatch/prisma-client/generated";
import { aesEncryption } from "@langwatch/process-stores";
import { createTestLogger } from "@langwatch/test-harness";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { PrismaCredentialsResealRepository } from "../../repositories/prisma/prisma.credentials-reseal.repository.ts";
import {
  CredentialsResealTask,
  resealCredentials,
  type CredentialsResealReport,
} from "../credentials-reseal.task.ts";

const DB_URL = process.env.LANGWATCH_TEST_DATABASE_URL;
const namespace = `reseal-${randomBytes(6).toString("hex")}`;

const previous = aesEncryption(randomBytes(32));
const current = aesEncryption(randomBytes(32));
const neither = aesEncryption(randomBytes(32));
const ciphers = { current, previous };

const opensUnder = (cipher: typeof current, sealed: string): string | undefined => {
  try {
    return cipher.decrypt(sealed);
  } catch {
    return undefined;
  }
};

const columnOf = (report: CredentialsResealReport, table: string, column: string) =>
  report.columns.find((each) => each.table === table && each.column === column);

describe.skipIf(!DB_URL)("the credentials-reseal task over Postgres", () => {
  const connection: PrismaConnection = PrismaConnectionService.create({
    guard: PrismaTenancyGuardService.create(),
    logger: createTestLogger().logger,
  }).connect(PrismaConfigService.create().resolve({ databaseUrl: DB_URL ?? "", log: ["error"] }));
  const prisma = connection.client as PrismaClient;
  const repository = PrismaCredentialsResealRepository.create({ database: prisma });
  const ids = { organization: "", team: "", project: "", nestedProvider: "", wholeProvider: "" };
  const sealed = {
    storageSecret: previous.encrypt("the-storage-secret"),
    storageKeyId: neither.encrypt("sealed-under-a-lost-key"),
    nestedProviderKey: previous.encrypt("sk-nested-provider-key"),
    wholeProviderKeys: previous.encrypt(JSON.stringify({ OPENAI_API_KEY: "sk-whole-document" })),
  };

  const storedProject = () =>
    prisma.project.findUniqueOrThrow({
      where: { id: ids.project },
      select: { s3AccessKeyId: true, s3SecretAccessKey: true },
    });
  const storedKeys = async (id: string): Promise<unknown> =>
    (
      await prisma.modelProvider.findFirstOrThrow({
        where: { id, organizationId: ids.organization },
        select: { customKeys: true },
      })
    ).customKeys;
  const nestedKey = async (): Promise<string> => {
    const keys = (await storedKeys(ids.nestedProvider)) as { OPENAI_API_KEY: string };
    return keys.OPENAI_API_KEY;
  };

  beforeAll(async () => {
    const organization = await prisma.organization.create({
      data: { name: `Org ${namespace}`, slug: `--test-org-${namespace}` },
    });
    ids.organization = organization.id;
    const team = await prisma.team.create({
      data: {
        name: `Team ${namespace}`,
        slug: `team-${namespace}`,
        organizationId: organization.id,
      },
    });
    ids.team = team.id;
    const project = await prisma.project.create({
      data: {
        id: `${namespace}-project`,
        name: `Project ${namespace}`,
        slug: `project-${namespace}`,
        apiKey: `sk-lw-test-${namespace}`,
        teamId: team.id,
        language: "python",
        framework: "openai",
        s3SecretAccessKey: sealed.storageSecret,
        s3AccessKeyId: sealed.storageKeyId,
      },
    });
    ids.project = project.id;
    const nested = await prisma.modelProvider.create({
      data: {
        name: `Nested ${namespace}`,
        provider: "openai",
        enabled: true,
        organizationId: organization.id,
        customKeys: {
          OPENAI_API_KEY: sealed.nestedProviderKey,
          OPENAI_BASE_URL: "https://api.example",
        },
        scopes: { create: [{ scopeType: "ORGANIZATION", scopeId: organization.id }] },
      },
    });
    ids.nestedProvider = nested.id;
    const whole = await prisma.modelProvider.create({
      data: {
        name: `Whole ${namespace}`,
        provider: "anthropic",
        enabled: true,
        organizationId: organization.id,
        customKeys: sealed.wholeProviderKeys,
        scopes: { create: [{ scopeType: "ORGANIZATION", scopeId: organization.id }] },
      },
    });
    ids.wholeProvider = whole.id;
  });

  afterAll(async () => {
    await prisma.modelProvider.deleteMany({ where: { organizationId: ids.organization } });
    await prisma.project.deleteMany({ where: { id: ids.project } });
    await prisma.team.deleteMany({ where: { id: ids.team } });
    await prisma.organization.deleteMany({ where: { id: ids.organization } });
    await PrismaShutdownService.create().shutdown(connection);
  });

  describe("when the operator runs it with --dry-run", () => {
    /** @scenario "A dry run reports what would be re-sealed and changes nothing" */
    it("counts the values under the previous key and leaves every one as stored", async () => {
      await CredentialsResealTask.create({
        repository: () => repository,
        ciphers: () => ({ ...ciphers, fingerprints: [] }),
        roster: () => ({ findLiveRoster: async () => [] }),
      }).run({
        args: ["--dry-run"],
        signal: new AbortController().signal,
      });
      const report = await resealCredentials({ repository, ciphers, dryRun: true });

      expect(report.mode).toBe("dry-run");
      expect(columnOf(report, "Project", "s3SecretAccessKey")).toMatchObject({ resealed: 1 });
      expect(columnOf(report, "ModelProvider", "customKeys")).toMatchObject({ resealed: 2 });
      expect(await storedProject()).toEqual({
        s3SecretAccessKey: sealed.storageSecret,
        s3AccessKeyId: sealed.storageKeyId,
      });
      expect(await nestedKey()).toBe(sealed.nestedProviderKey);
      expect(await storedKeys(ids.wholeProvider)).toBe(sealed.wholeProviderKeys);
    });
  });

  describe("when the operator runs it", () => {
    let report: CredentialsResealReport;

    beforeAll(async () => {
      report = await resealCredentials({ repository, ciphers });
    });

    /** @scenario "The re-seal task makes the previous secret removable" */
    it("leaves each credential open under the new key alone, in the text and the JSON column", async () => {
      const project = await storedProject();
      const nested = await nestedKey();
      const whole = (await storedKeys(ids.wholeProvider)) as string;

      expect(current.decrypt(project.s3SecretAccessKey ?? "")).toBe("the-storage-secret");
      expect(current.decrypt(nested)).toBe("sk-nested-provider-key");
      expect(JSON.parse(current.decrypt(whole))).toEqual({ OPENAI_API_KEY: "sk-whole-document" });
      for (const value of [project.s3SecretAccessKey ?? "", nested, whole]) {
        expect(opensUnder(previous, value)).toBeUndefined();
      }
      expect(await storedKeys(ids.nestedProvider)).toMatchObject({
        OPENAI_BASE_URL: "https://api.example",
      });
      expect(report.mode).toBe("apply");
      expect(columnOf(report, "Project", "s3SecretAccessKey")).toMatchObject({
        resealed: 1,
        alreadyCurrent: 0,
        changedMeanwhile: 0,
      });
      expect(columnOf(report, "ModelProvider", "customKeys")).toMatchObject({
        resealed: 2,
        alreadyCurrent: 0,
        changedMeanwhile: 0,
      });
    });

    /** @scenario "A value sealed under neither secret is reported and left alone" */
    it("counts a value neither key opens as undecryptable and leaves it as stored", async () => {
      expect(columnOf(report, "Project", "s3AccessKeyId")?.undecryptable).toBeGreaterThanOrEqual(1);
      expect(columnOf(report, "Project", "s3AccessKeyId")).toMatchObject({ resealed: 0 });
      expect((await storedProject()).s3AccessKeyId).toBe(sealed.storageKeyId);
      expect(neither.decrypt(sealed.storageKeyId)).toBe("sealed-under-a-lost-key");
    });
  });

  describe("when the operator runs it again", () => {
    /** @scenario "Running the re-seal task again changes nothing" */
    it("re-seals nothing and counts the moved credentials as already current", async () => {
      const before = { project: await storedProject(), nested: await nestedKey() };

      const report = await resealCredentials({ repository, ciphers });

      expect(report.totals.resealed).toBe(0);
      expect(columnOf(report, "Project", "s3SecretAccessKey")).toMatchObject({ alreadyCurrent: 1 });
      expect(columnOf(report, "ModelProvider", "customKeys")).toMatchObject({ alreadyCurrent: 2 });
      expect(await storedProject()).toEqual(before.project);
      expect(await nestedKey()).toBe(before.nested);
    });
  });
});
