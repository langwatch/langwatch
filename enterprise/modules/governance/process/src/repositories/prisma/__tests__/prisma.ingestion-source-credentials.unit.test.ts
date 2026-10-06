// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * @vitest-environment node
 */
import { Buffer } from "node:buffer";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

import type { IngestionSource, Prisma } from "@langwatch/prisma-client/generated";
import { aesEncryption } from "@langwatch/process-stores";
import { prismaDouble } from "@langwatch/test-harness/client-doubles/prisma";
import { describe, expect, it, vi } from "vitest";

import { credentialsOf } from "../../../rules/ingestion-credentials.rules.ts";
import { PrismaIngestionSourceCredentialsMapper } from "../prisma.ingestion-source-credentials.mapper.ts";
import { PrismaIngestionSourceRepository } from "../prisma.ingestion-source.repository.ts";

const key = randomBytes(32);

/** Main's sealing, written out by hand: AES-256-GCM, hex `iv:body:tag` behind `enc:v1:`. */
function sealedTheOldWay(credentials: Record<string, string>): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const body = Buffer.concat([cipher.update(JSON.stringify(credentials), "utf8"), cipher.final()]);
  const sealed = [iv, body, cipher.getAuthTag()].map((part) => part.toString("hex")).join(":");
  return `enc:v1:${sealed}`;
}

/** Main's opening, written out by hand, so a value this store writes is proven readable by main. */
function openedTheOldWay(stored: string): unknown {
  const [iv, body, tag] = stored
    .slice("enc:v1:".length)
    .split(":")
    .map((part) => Buffer.from(part, "hex"));
  const decipher = createDecipheriv("aes-256-gcm", key, iv!);
  decipher.setAuthTag(tag!);
  return JSON.parse(Buffer.concat([decipher.update(body!), decipher.final()]).toString("utf8"));
}

function row(parserConfig: Record<string, unknown>): IngestionSource {
  const at = new Date("2026-10-01T00:00:00.000Z");
  return {
    id: "source-1",
    organizationId: "org-1",
    teamId: null,
    traceProjectId: null,
    sourceType: "openai_admin",
    name: "OpenAI",
    description: null,
    ingestSecretHash: "",
    parserConfig: parserConfig as Prisma.JsonObject,
    pollerCursor: null,
    errorCount: 0,
    pullSchedule: null,
    status: "active",
    providerAccountId: null,
    lastEventAt: null,
    lastSuccessAt: null,
    lastReadThroughAt: null,
    lastRunCompleteness: null,
    unpricedUsageSince: null,
    unpricedUsageThrough: null,
    archivedAt: null,
    createdAt: at,
    updatedAt: at,
    createdById: "user-1",
  };
}

function repositoryOver(stored: IngestionSource) {
  const create = vi.fn(async (args: Prisma.IngestionSourceCreateArgs) =>
    row(args.data.parserConfig as Record<string, unknown>),
  );
  const update = vi.fn(async (args: Prisma.IngestionSourceUpdateArgs) =>
    row((args.data.parserConfig ?? stored.parserConfig) as Record<string, unknown>),
  );
  const findUnique = vi.fn(async () => stored);
  const repository = PrismaIngestionSourceRepository.create({
    database: prismaDouble({ ingestionSource: { create, update, findUnique } }),
    cipher: aesEncryption(key),
  });
  const written = () =>
    [...create.mock.calls, ...update.mock.calls].map(
      ([args]) => args.data.parserConfig as Record<string, unknown>,
    );
  return { repository, written };
}

describe("the ingestion-source store's credentials at rest", () => {
  describe("given a row main sealed under the process key", () => {
    it("reads it back opened, the rest of the config untouched", async () => {
      const { repository } = repositoryOver(
        row({ adapter: "openai_admin", credentials: sealedTheOldWay({ token: "sk-admin-1" }) }),
      );

      const source = await repository.findById("source-1");

      expect(source?.parserConfig).toEqual({
        adapter: "openai_admin",
        credentials: { token: "sk-admin-1" },
      });
    });

    it("writes an edit back in the form main opens", async () => {
      const { repository, written } = repositoryOver(row({}));

      await repository.update("source-1", {
        parserConfig: { adapter: "openai_admin", credentials: { token: "sk-admin-2" } },
      });

      const [stored] = written();
      expect(stored?.adapter).toBe("openai_admin");
      expect(stored?.credentials as string).toMatch(/^enc:v1:[0-9a-f]+:[0-9a-f]+:[0-9a-f]+$/);
      expect(openedTheOldWay(stored?.credentials as string)).toEqual({ token: "sk-admin-2" });
    });
  });

  describe("given an admin saves an OpenAI Admin source carrying an admin API key", () => {
    /** @scenario "The Admin API key is never stored in plain text" */
    it("stores the key encrypted, unreadable from the serialised config", async () => {
      const token = "sk-admin-abcdef123456";
      const { repository, written } = repositoryOver(row({}));

      await repository.create({
        organizationId: "org-1",
        teamId: null,
        traceProjectId: null,
        sourceType: "openai_admin",
        name: "OpenAI",
        description: null,
        ingestSecretHash: "",
        parserConfig: { adapter: "openai_admin", report: "cost", credentials: { token } },
        pullSchedule: null,
        status: "awaiting_first_event",
        createdById: "user-1",
        providerAccountId: null,
      });

      const [stored] = written();
      expect(JSON.stringify(stored)).not.toContain(token);
      expect(stored?.credentials as string).toMatch(/^enc:v1:/);
      expect(stored?.report).toBe("cost");
    });
  });

  describe("given a row sealed under another key", () => {
    it("keeps the stored form, which a provider call then refuses", async () => {
      const foreign = PrismaIngestionSourceCredentialsMapper.create({
        cipher: aesEncryption(randomBytes(32)),
      }).seal({ credentials: { token: "elsewhere" } }).credentials as string;
      const { repository, written } = repositoryOver(row({ credentials: foreign }));

      const source = await repository.findById("source-1");
      await repository.update("source-1", { parserConfig: source!.parserConfig });

      expect(source?.parserConfig.credentials).toBe(foreign);
      expect(written()[0]?.credentials).toBe(foreign);
      expect(() => credentialsOf(source?.parserConfig.credentials)).toThrow(/could not be opened/);
    });
  });

  describe("given credentials the mapper already sealed", () => {
    it("leaves them as they are rather than sealing twice", () => {
      const mapper = PrismaIngestionSourceCredentialsMapper.create({ cipher: aesEncryption(key) });
      const once = mapper.seal({ credentials: { token: "t" } });

      expect(mapper.seal(once).credentials).toBe(once.credentials);
    });
  });

  describe("given a config with no credentials, or a legacy plaintext bag", () => {
    it("stores and reads each as it is", () => {
      const mapper = PrismaIngestionSourceCredentialsMapper.create({ cipher: aesEncryption(key) });
      const bare = { ottlStatements: ["x"] };
      const legacy = { credentials: { aws_access_key_id: "AKIA" } };

      expect(mapper.seal(bare)).toEqual(bare);
      expect(mapper.open(bare)).toEqual(bare);
      expect(mapper.open(legacy)).toEqual(legacy);
    });
  });
});
