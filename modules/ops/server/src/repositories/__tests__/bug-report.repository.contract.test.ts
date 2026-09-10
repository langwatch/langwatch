/**
 * @vitest-environment node
 * The support inbox's contract, stated once and run against both backends: the
 * memory twin always, the Postgres one when `LANGWATCH_TEST_DATABASE_URL` is
 * named. @see specs/support/bug-reports.feature
 */
import { randomUUID } from "node:crypto";
import type { BugReportCreateInput } from "@langwatch/ops-contract";
import {
  PrismaConfigService,
  PrismaConnectionService,
  PrismaTenancyGuardService,
} from "@langwatch/prisma-client";
import type { PrismaClient } from "@langwatch/prisma-client/generated";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import type { BugReportRepository } from "../admin/bug-report.repository.ts";
import { MemoryBugReportRepository } from "../memory/memory.bug-report.repository.ts";
import { MemoryOpsStore } from "../memory/memory.ops.store.ts";
import { PrismaBugReportRepository } from "../prisma/prisma.bug-report.repository.ts";

function report(overrides: Partial<BugReportCreateInput> = {}): BugReportCreateInput {
  return {
    source: "cli",
    kind: "summary",
    title: "The CLI could not reach the API",
    summary: "It refused the key I had just minted.",
    agent: "claude-code",
    contactEmail: "reporter@acme.com",
    ...overrides,
  };
}

/** Two reports filed in the same millisecond have no order; these do not. */
function apart(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 5));
}

function contractCases(backend: { repository: () => BugReportRepository }): void {
  describe("when the inbox is read", () => {
    it("lists the newest report first and counts them all", async () => {
      const repository = backend.repository();
      await repository.create({ data: report({ title: "First" }) });
      await apart();
      await repository.create({ data: report({ title: "Second" }) });

      const page = await repository.findAll({ page: 0, pageSize: 10 });

      expect(page.map((row) => row.title)).toEqual(["Second", "First"]);
      await expect(repository.count()).resolves.toBe(2);
    });

    it("carries no transcript in the listing and the whole one when opened", async () => {
      const repository = backend.repository();
      const created = await repository.create({
        data: report({ kind: "full_session", sessionData: "the whole transcript" }),
      });

      const [listed] = await repository.findAll({ page: 0, pageSize: 10 });

      expect(listed).not.toHaveProperty("sessionData");
      await expect(repository.findById({ id: created.id })).resolves.toMatchObject({
        sessionData: "the whole transcript",
      });
    });

    it("answers absence with null rather than a refusal", async () => {
      await expect(
        backend.repository().findById({ id: "bugreport_absent" }),
      ).resolves.toBeNull();
    });

    it("pages the listing without changing the count", async () => {
      const repository = backend.repository();
      await repository.create({ data: report({ title: "First" }) });
      await apart();
      await repository.create({ data: report({ title: "Second" }) });

      const second = await repository.findAll({ page: 1, pageSize: 1 });

      expect(second.map((row) => row.title)).toEqual(["First"]);
      await expect(repository.count()).resolves.toBe(2);
    });
  });

  describe("when a search term narrows the inbox", () => {
    it("matches the searched columns case-insensitively, count included", async () => {
      const repository = backend.repository();
      await repository.create({ data: report({ title: "Ingestion is silent" }) });
      await repository.create({
        data: report({ title: "Other", agent: "codex", contactEmail: "sam@other.test" }),
      });

      await expect(
        repository.findAll({ page: 0, pageSize: 10, search: "INGESTION" }),
      ).resolves.toHaveLength(1);
      await expect(repository.count({ search: "codex" })).resolves.toBe(1);
      await expect(repository.count({ search: "sam@other" })).resolves.toBe(1);
      await expect(repository.count({ search: "nothing here" })).resolves.toBe(0);
    });
  });
}

describe("given the memory support inbox", () => {
  let repository: BugReportRepository;

  beforeEach(() => {
    repository = MemoryBugReportRepository.create({ store: MemoryOpsStore.create() });
  });

  contractCases({ repository: () => repository });
});

const databaseUrl = process.env.LANGWATCH_TEST_DATABASE_URL;
const connection = databaseUrl
  ? PrismaConnectionService.create({ guard: PrismaTenancyGuardService.create() }).connect(
      PrismaConfigService.create().resolve({ databaseUrl, log: ["error"] }),
    )
  : null;

function database(): PrismaClient {
  if (connection === null) throw new Error("LANGWATCH_TEST_DATABASE_URL is required here");

  return connection.client as PrismaClient;
}

describe.skipIf(!databaseUrl)("given the Postgres support inbox", () => {
  const namespace = `bug-report-contract-${randomUUID().slice(0, 8)}`;

  /** The table is global, so the rows this run made are the ones it removes. */
  const written: string[] = [];

  function tracked(): BugReportRepository {
    const repository = PrismaBugReportRepository.create({ prisma: database() });

    return {
      count: (input) => repository.count(input),
      findAll: (input) => repository.findAll(input),
      findById: (input) => repository.findById(input),
      create: async (input) => {
        const created = await repository.create({
          data: { ...input.data, cliVersion: namespace },
        });
        written.push(created.id);

        return created;
      },
    };
  }

  beforeEach(async () => {
    await database().bugReport.deleteMany({ where: { id: { in: written } } });
    written.length = 0;
  });

  afterAll(async () => {
    await database().bugReport.deleteMany({ where: { cliVersion: namespace } });
    await connection?.disconnect();
  });

  contractCases({ repository: tracked });
});
