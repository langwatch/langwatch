import {
  PrismaConfigService,
  PrismaConnectionService,
  type PrismaQueryContext,
  type PrismaQueryExecutor,
  PrismaQueryGuard,
} from "@langwatch/prisma-client";
import type { Prisma, PrismaClient } from "@langwatch/prisma-client/generated";
import { createTestLogger } from "@langwatch/test-harness";
import { cleanupTestRows } from "@langwatch/test-harness/prisma";
import { nanoid } from "nanoid";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import type { ProcessRef } from "../../../../process-manager/processManager.types.ts";
import { PrismaProcessStore } from "../prisma-process-store.ts";

class AllowTestQueries extends PrismaQueryGuard {
  execute(context: PrismaQueryContext, next: PrismaQueryExecutor): Promise<unknown> {
    return next(context.args);
  }
}

const databaseUrl = process.env.DATABASE_URL;
const connection = databaseUrl
  ? PrismaConnectionService.create({
      guard: new AllowTestQueries(),
      logger: createTestLogger().logger,
    }).connect(PrismaConfigService.create().resolve({ databaseUrl, log: ["error"] }))
  : null;

class RolledBack extends Error {}

let prisma: PrismaClient;
let store: PrismaProcessStore;
let processName: string;

function ref(): ProcessRef {
  return { processName, projectId: "project-1", processKey: "audit" };
}

function append({ transaction }: { transaction?: object }) {
  return store.appendIntents({
    ref: ref(),
    tenantId: "project-1",
    sourceEventId: null,
    messages: [
      { messageKey: "intent-1", intentType: "recordAudit", payload: {}, traceCarrier: {} },
    ],
    now: 1_000,
    transaction,
  });
}

describe.skipIf(!databaseUrl)("PrismaProcessStore appending inside a caller's transaction", () => {
  beforeAll(() => {
    if (connection === null) throw new Error("DATABASE_URL is required");
    prisma = connection.client;
    store = PrismaProcessStore.create({ database: prisma });
  });

  beforeEach(() => {
    processName = `caller-tx-${nanoid(10)}`;
  });

  afterEach(async () => {
    await cleanupTestRows(prisma, [["processManagerOutbox", { processName }]]);
  });

  describe("when the transaction commits", () => {
    /** @scenario "Intents appended inside a caller's transaction commit with it" */
    it("leaves the intent pending in the outbox", async () => {
      await prisma.$transaction(async (transaction: Prisma.TransactionClient) => {
        await append({ transaction });
      });

      const rows = await store.findMessagesByRef({ ref: ref() });
      expect(rows.map((row) => [row.messageKey, row.status])).toEqual([["intent-1", "pending"]]);
    });
  });

  describe("when the transaction rolls back", () => {
    /** @scenario "Intents appended inside a rolled-back transaction leave no outbox row" */
    it("leaves no outbox row", async () => {
      await expect(
        prisma.$transaction(async (transaction: Prisma.TransactionClient) => {
          await append({ transaction });
          throw new RolledBack();
        }),
      ).rejects.toBeInstanceOf(RolledBack);

      expect(await store.findMessagesByRef({ ref: ref() })).toEqual([]);
    });
  });

  describe("when the value passed is not a Prisma transaction", () => {
    /** @scenario "A transaction that is not a Prisma transaction is refused" */
    it("refuses the append and writes nothing", async () => {
      await expect(append({ transaction: { processManagerOutbox: {} } })).rejects.toThrow(
        /Prisma transaction/,
      );

      expect(await store.findMessagesByRef({ ref: ref() })).toEqual([]);
    });
  });
});
