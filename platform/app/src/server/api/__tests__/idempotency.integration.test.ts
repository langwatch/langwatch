/**
 * @vitest-environment node
 *
 * The fenced receipt writes against a real Postgres, interleaved on one row.
 *
 * The unit test proves each write names the claim it holds. This proves the
 * database refuses the write whose claim is gone by the time it runs, which
 * is only visible when the two statements overlap: the first is held open in
 * its own transaction until the second is parked on its row lock, and only
 * then commits. A write whose fence sits in a subquery passes that re-check on
 * its own older snapshot and both callers are told yes.
 *
 * `IdempotencyReceipt` carries its tenancy on `scopeId`, so every row here
 * belongs to a scope named after this run.
 *
 * @see ../idempotency.ts
 * @see specs/ai-gateway/idempotency.feature
 */
import { nanoid } from "nanoid";
import { afterAll, describe, expect, it } from "vitest";
import type { Prisma } from "~/generated/prisma/client";
import { prisma } from "~/server/db";
import { raceOnOneRow } from "~/test-utils/rowLockInterleaving";
import {
  finalizeClaim,
  RECEIPT_TTL_MS,
  TAKEOVER_AFTER_MS,
  takeOverClaim,
} from "../idempotency";

const SCOPE = `idem-${nanoid(8)}`;

/** A pending receipt whose holder stopped reporting itself alive. */
async function silentClaim() {
  const now = new Date();
  return prisma.idempotencyReceipt.create({
    data: {
      scopeId: SCOPE,
      key: `key-${nanoid(8)}`,
      claimId: `claim-${nanoid(8)}`,
      requestFingerprint: "fingerprint",
      heartbeatAt: new Date(now.getTime() - TAKEOVER_AFTER_MS - 1_000),
      expiresAt: new Date(now.getTime() + RECEIPT_TTL_MS),
    },
  });
}

const stored = (id: string) =>
  prisma.idempotencyReceipt.findFirst({ where: { id, scopeId: SCOPE } });

afterAll(async () => {
  await prisma.idempotencyReceipt.deleteMany({ where: { scopeId: SCOPE } });
});

describe("idempotency receipts on Postgres", () => {
  describe("given a claim that stopped reporting itself alive", () => {
    describe("when two retries take it over at the same moment", () => {
      /** @scenario "Two retries taking over one silent claim resolve to one winner" */
      it("hands the claim to the first and sends the second back to re-read", async () => {
        const existing = await silentClaim();
        const now = new Date();
        const takeOver = (tx: Prisma.TransactionClient) =>
          takeOverClaim({ prisma: tx, existing, now });

        const verdicts = await raceOnOneRow({
          prisma,
          table: "IdempotencyReceipt",
          first: takeOver,
          second: takeOver,
        });

        expect(verdicts.first.kind).toBe("claimed");
        expect(verdicts.second.kind).toBe("retry");
        const claimId =
          verdicts.first.kind === "claimed" ? verdicts.first.claimId : null;
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
              prisma: tx,
              receiptId: existing.id,
              claimId: existing.claimId,
              status: 201,
              serializedBody: '{"id":"original"}',
            });
            return "finalized";
          },
          second: async (tx) =>
            (await takeOverClaim({ prisma: tx, existing, now: new Date() }))
              .kind,
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
            (await takeOverClaim({ prisma: tx, existing, now: new Date() }))
              .kind,
          second: async (tx) => {
            await finalizeClaim({
              prisma: tx,
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
