/**
 * @vitest-environment node
 * @see specs/ai-gateway/idempotency.feature
 * The fenced receipt writes the API surface composes, interleaved on one real
 * Postgres row: the database refuses the write whose claim is gone by then.
 */
import { randomUUID } from "node:crypto";

import {
  finalizeClaim,
  RECEIPT_TTL_MS,
  TAKEOVER_AFTER_MS,
  takeOverClaim,
} from "@langwatch/api/rest";
import { createLogger } from "@langwatch/observability";
import {
  PrismaConfigService,
  PrismaConnectionService,
  PrismaTenancyGuardService,
} from "@langwatch/prisma-client";
import type { Prisma } from "@langwatch/prisma-client/generated";
import { nowInstant } from "@langwatch/time";
import { afterAll, describe, expect, it } from "vitest";

import { raceOnOneRow } from "./support/row-lock-race.ts";

const DB_URL = process.env.LANGWATCH_TEST_DATABASE_URL;

const identityCipher = { encrypt: (value: string) => value, decrypt: (value: string) => value };

describe.skipIf(!DB_URL)("idempotency receipts on Postgres", () => {
  const scope = `idem-${randomUUID().slice(0, 8)}`;
  const connection = PrismaConnectionService.create({
    guard: PrismaTenancyGuardService.create(),
    logger: createLogger("langwatch:process-server:test:idempotency-race"),
  }).connect(PrismaConfigService.create().resolve({ databaseUrl: DB_URL ?? "", log: ["error"] }));
  const prisma = connection.client;

  /** A pending receipt whose holder stopped reporting itself alive. */
  async function silentClaim() {
    const now = Date.now();
    return prisma.idempotencyReceipt.create({
      data: {
        scopeId: scope,
        key: `key-${randomUUID()}`,
        claimId: `claim-${randomUUID()}`,
        requestFingerprint: "fingerprint",
        heartbeatAt: new Date(now - TAKEOVER_AFTER_MS - 1_000),
        expiresAt: new Date(now + RECEIPT_TTL_MS),
      },
    });
  }

  const stored = (id: string) =>
    prisma.idempotencyReceipt.findFirst({ where: { id, scopeId: scope } });

  afterAll(async () => {
    await prisma.idempotencyReceipt.deleteMany({ where: { scopeId: scope } });
    await prisma.$disconnect();
  });

  describe("given a claim that stopped reporting itself alive", () => {
    describe("when two retries take it over at the same moment", () => {
      /** @scenario "Two retries taking over one silent claim resolve to one winner" */
      it("hands the claim to the first and sends the second back to re-read", async () => {
        const existing = await silentClaim();
        const takeOver = (tx: Prisma.TransactionClient) =>
          takeOverClaim({ receipts: tx, existing, now: nowInstant() });

        const verdicts = await raceOnOneRow({
          prisma,
          table: "IdempotencyReceipt",
          first: takeOver,
          second: takeOver,
        });

        expect(verdicts.first.kind).toBe("claimed");
        expect(verdicts.second.kind).toBe("retry");
        const claimId = verdicts.first.kind === "claimed" ? verdicts.first.claimId : "";
        expect((await stored(existing.id))?.claimId).toBe(claimId);
      });
    });

    describe("when the original stores its response while a takeover is waiting on the row", () => {
      /** @scenario "A takeover that waited on the original's response is refused" */
      it("keeps the response and sends the takeover back to re-read", async () => {
        const existing = await silentClaim();

        const answers = await raceOnOneRow<string>({
          prisma,
          table: "IdempotencyReceipt",
          first: async (tx) => {
            await finalizeClaim({
              receipts: tx,
              cipher: identityCipher,
              receiptId: existing.id,
              claimId: existing.claimId,
              status: 201,
              serializedBody: '{"id":"original"}',
            });
            return "finalized";
          },
          second: async (tx) =>
            (await takeOverClaim({ receipts: tx, existing, now: nowInstant() })).kind,
        });

        expect(answers.second).toBe("retry");
        const row = await stored(existing.id);
        expect(row?.responseStatus).toBe(201);
        expect(row?.claimId).toBe(existing.claimId);
      });
    });
  });

  describe("given a claim taken over while the request holding it was still running", () => {
    describe("when that request stores its response", () => {
      /** @scenario "A replaced request cannot overwrite the receipt that replaced it" */
      it("writes nothing, so the receipt still belongs to the claim that replaced it", async () => {
        const existing = await silentClaim();

        const answers = await raceOnOneRow<string>({
          prisma,
          table: "IdempotencyReceipt",
          first: async (tx) =>
            (await takeOverClaim({ receipts: tx, existing, now: nowInstant() })).kind,
          second: async (tx) => {
            await finalizeClaim({
              receipts: tx,
              cipher: identityCipher,
              receiptId: existing.id,
              claimId: existing.claimId,
              status: 201,
              serializedBody: '{"id":"displaced"}',
            });
            return "finalized";
          },
        });

        expect(answers.first).toBe("claimed");
        const row = await stored(existing.id);
        expect(row?.claimId).not.toBe(existing.claimId);
        expect(row?.responseStatus).toBeNull();
        expect(row?.responseBody).toBeNull();
      });
    });
  });
});
