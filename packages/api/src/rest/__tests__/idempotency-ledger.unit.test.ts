/**
 * @vitest-environment node
 *
 * The receipt ledger behind `Idempotency-Key`.
 *
 * Driven against an in-memory receipt store that keeps the ONE property the
 * protocol is built on: the unique index over (scopeId, key), so a second
 * insert under a live key loses rather than creating alongside the first.
 * Everything the ledger decides — replay, refusal, takeover — is read off
 * that loss, so a fake without it would pass while proving nothing.
 *
 * @see packages/api/src/rest/idempotency-ledger.ts
 * @see specs/ai-gateway/idempotency.feature
 */

import { describe, expect, it } from "vitest";

import {
  IdempotencyLedger,
  type IdempotencyReceiptCreateInput,
  type IdempotencyReceiptPersistence,
  type IdempotencyReceiptRecord,
  type IdempotencyReceiptUpdateInput,
  type IdempotencyResponseCipher,
  isClaimAbandoned,
  RECEIPT_TTL_MS,
  TAKEOVER_AFTER_MS,
} from "@langwatch/api/rest";

const SCOPE = "project_acme";
const KEY = "order-4711";

/**
 * A receipt store with a unique index, and nothing else.
 *
 * The rows are held by `${scopeId}:${key}` rather than by id precisely so a
 * duplicate insert throws the way Postgres does — `code: "P2002"`, which is
 * what the ledger duck-types the loss on.
 */
class FakeReceiptStore implements IdempotencyReceiptPersistence {
  private readonly rows = new Map<
    string,
    IdempotencyReceiptRecord & { scopeId: string; key: string }
  >();
  private nextId = 1;

  readonly idempotencyReceipt = {
    create: async (input: { data: IdempotencyReceiptCreateInput; select: { id: true } }) => {
      const unique = `${input.data.scopeId}:${input.data.key}`;
      if (this.rows.has(unique)) {
        throw Object.assign(new Error("Unique constraint failed"), { code: "P2002" });
      }
      const id = `receipt_${this.nextId++}`;
      this.rows.set(unique, {
        id,
        scopeId: input.data.scopeId,
        key: input.data.key,
        claimId: input.data.claimId,
        requestFingerprint: input.data.requestFingerprint,
        heartbeatAt: input.data.heartbeatAt,
        expiresAt: input.data.expiresAt,
        responseStatus: null,
        responseBody: null,
      });
      return { id };
    },

    findUnique: async (input: { where: { scopeId_key: { scopeId: string; key: string } } }) =>
      this.rows.get(`${input.where.scopeId_key.scopeId}:${input.where.scopeId_key.key}`) ?? null,

    updateMany: async (input: {
      where: { id: string; claimId?: string; responseStatus?: null };
      data: IdempotencyReceiptUpdateInput;
    }) => {
      const row = this.byId(input.where.id);
      if (!row) return { count: 0 };
      if (input.where.claimId !== undefined && row.claimId !== input.where.claimId) {
        return { count: 0 };
      }
      if (input.where.responseStatus === null && row.responseStatus !== null) {
        return { count: 0 };
      }
      Object.assign(row, input.data);
      return { count: 1 };
    },

    deleteMany: async (input: { where: { id: string; claimId?: string } }) => {
      const found = [...this.rows.entries()].find(([, row]) => row.id === input.where.id);
      if (!found) return { count: 0 };
      const [unique, row] = found;
      if (input.where.claimId !== undefined && row.claimId !== input.where.claimId) {
        return { count: 0 };
      }
      this.rows.delete(unique);
      return { count: 1 };
    },
  };

  private byId(id: string) {
    return [...this.rows.values()].find((row) => row.id === id);
  }

  get size(): number {
    return this.rows.size;
  }
}

/**
 * A cipher that is a round trip and says so.
 *
 * The prefix is what makes a stored body visibly ciphertext in an assertion:
 * a ledger that forgot to encrypt would store the JSON and this test would
 * still pass on a bare identity function.
 */
const cipher: IdempotencyResponseCipher = {
  encrypt: (value) => `enc:${value}`,
  decrypt: (value) => {
    if (!value.startsWith("enc:")) throw new Error("not written by this cipher");
    return value.slice("enc:".length);
  },
};

function ledgerOver(receipts: IdempotencyReceiptPersistence) {
  return IdempotencyLedger.create({ receipts, cipher });
}

/**
 * The handled error one run rejected with, and proof that it rejected at all.
 *
 * A helper rather than `.catch()` at each site: catching widens the awaited
 * value to "the outcome OR the error", so every assertion below has to argue
 * with a branch these scenarios exist to rule out. A run that resolves fails
 * HERE, naming what happened, instead of failing on a missing `code`.
 */
async function refusalFrom(
  run: Promise<unknown>,
): Promise<{ code?: string; meta?: { reason?: string } }> {
  try {
    await run;
  } catch (error) {
    return error as { code?: string; meta?: { reason?: string } };
  }
  throw new Error("the ledger accepted a run this scenario requires it to refuse");
}

/** A create that reports how many times it actually ran. */
function countingHandler(body: unknown) {
  let runs = 0;
  return {
    get runs() {
      return runs;
    },
    handler: async () => {
      runs++;
      return { status: 201, body };
    },
  };
}

describe("the Idempotency-Key receipt ledger", () => {
  describe("given a request that carries no key", () => {
    it("runs the handler and stores nothing", async () => {
      const receipts = new FakeReceiptStore();
      const create = countingHandler({ id: "budget_1" });

      const outcome = await ledgerOver(receipts).run({
        operation: "gateway.v1.budgets.create",
        scopeId: SCOPE,
        key: null,
        validatedBody: { limit: 10 },
        handler: create.handler,
      });

      expect(outcome).toMatchObject({ isReplayed: false, status: 201 });
      expect(create.runs).toBe(1);
      expect(receipts.size).toBe(0);
    });
  });

  describe("given a create that already answered under a key", () => {
    /** @scenario "Retrying a create with the same key replays the first response" */
    it("replays the stored response without running the handler again", async () => {
      const receipts = new FakeReceiptStore();
      const ledger = ledgerOver(receipts);
      const first = countingHandler({ id: "budget_1", secret: "shown once" });
      const request = {
        operation: "gateway.v1.budgets.create",
        scopeId: SCOPE,
        key: KEY,
        validatedBody: { limit: 10 },
      };

      const original = await ledger.run({ ...request, handler: first.handler });
      const second = countingHandler({ id: "budget_2", secret: "a different one" });
      const replay = await ledger.run({ ...request, handler: second.handler });

      expect(original).toMatchObject({ isReplayed: false, status: 201 });
      expect(replay).toEqual({
        isReplayed: true,
        status: 201,
        // Byte-for-byte the first response, which is the whole point: the
        // secret it carries exists nowhere else in readable form.
        serializedBody: JSON.stringify({ id: "budget_1", secret: "shown once" }),
      });
      expect(second.runs).toBe(0);
    });

    /** @scenario "Reusing a key with a different body is refused" */
    it("refuses the same key under a different body, naming the reason", async () => {
      const receipts = new FakeReceiptStore();
      const ledger = ledgerOver(receipts);
      const request = {
        operation: "gateway.v1.budgets.create",
        scopeId: SCOPE,
        key: KEY,
      };

      await ledger.run({
        ...request,
        validatedBody: { limit: 10 },
        handler: countingHandler({ id: "budget_1" }).handler,
      });
      const changed = countingHandler({ id: "budget_2" });

      const refusal = await refusalFrom(
        ledger.run({ ...request, validatedBody: { limit: 99 }, handler: changed.handler }),
      );

      expect(refusal.code).toBe("idempotency_error");
      expect(refusal.meta?.reason).toBe("body_mismatch");
      expect(changed.runs).toBe(0);
    });

    /** @scenario "One key cannot answer for two different creates" */
    it("refuses one key reused across two different creates in one tenancy", async () => {
      const receipts = new FakeReceiptStore();
      const ledger = ledgerOver(receipts);
      const body = { name: "shared" };

      await ledger.run({
        operation: "gateway.v1.virtual-keys.create",
        scopeId: SCOPE,
        key: KEY,
        validatedBody: body,
        handler: countingHandler({ id: "vk_1" }).handler,
      });
      const cacheRule = countingHandler({ id: "cache_rule_1" });

      const refusal = await refusalFrom(
        ledger.run({
          operation: "gateway.v1.cache-rules.create",
          scopeId: SCOPE,
          key: KEY,
          validatedBody: body,
          handler: cacheRule.handler,
        }),
      );

      expect(refusal.code).toBe("idempotency_error");
      expect(refusal.meta?.reason).toBe("body_mismatch");
      expect(cacheRule.runs).toBe(0);
    });
  });

  describe("given two requests sent concurrently under one key", () => {
    /** @scenario "A retry sent while the original is still running is refused" */
    it("executes once and refuses the other as in_progress", async () => {
      const receipts = new FakeReceiptStore();
      const ledger = ledgerOver(receipts);
      let runs = 0;
      let releaseFirst: (() => void) | undefined;
      const held = new Promise<void>((resolve) => {
        releaseFirst = resolve;
      });
      const request = {
        operation: "gateway.v1.budgets.create",
        scopeId: SCOPE,
        key: KEY,
        validatedBody: { limit: 10 },
      };

      const slow = ledger.run({
        ...request,
        handler: async () => {
          runs++;
          await held;
          return { status: 201, body: { id: "budget_1" } };
        },
      });
      const retry = refusalFrom(
        ledger.run({
          ...request,
          handler: async () => {
            runs++;
            return { status: 201, body: { id: "budget_2" } };
          },
        }),
      );

      const refusal = await retry;
      releaseFirst?.();
      const original = await slow;

      expect(original).toMatchObject({ isReplayed: false, status: 201 });
      expect(refusal.code).toBe("idempotency_error");
      expect(refusal.meta?.reason).toBe("in_progress");
      // The one assertion the whole protocol exists for: two requests, one
      // execution, so one create cannot mint two resources.
      expect(runs).toBe(1);
      expect(receipts.size).toBe(1);
    });
  });

  describe("given a handler that fails", () => {
    it("frees the key rather than pinning the failure to it", async () => {
      const receipts = new FakeReceiptStore();
      const ledger = ledgerOver(receipts);
      const request = {
        operation: "gateway.v1.budgets.create",
        scopeId: SCOPE,
        key: KEY,
        validatedBody: { limit: 10 },
      };

      await expect(
        ledger.run({
          ...request,
          handler: () => Promise.reject(new Error("the database blinked")),
        }),
      ).rejects.toThrow("the database blinked");
      const retry = countingHandler({ id: "budget_1" });
      const outcome = await ledger.run({ ...request, handler: retry.handler });

      expect(outcome).toMatchObject({ isReplayed: false, status: 201 });
      expect(retry.runs).toBe(1);
    });
  });

  describe("given a claim made long ago", () => {
    /** @scenario "Takeover turns on the last beat, not on the claim's age" */
    it("is not abandoned while it is still reporting itself alive", () => {
      const now = new Date();
      const longAfterAnyFixedWindow = new Date(now.getTime() - RECEIPT_TTL_MS + 1_000);

      expect(isClaimAbandoned({ heartbeatAt: new Date(now.getTime() - 1_000), now })).toBe(false);
      expect(isClaimAbandoned({ heartbeatAt: longAfterAnyFixedWindow, now })).toBe(true);
      expect(
        isClaimAbandoned({ heartbeatAt: new Date(now.getTime() - TAKEOVER_AFTER_MS - 1), now }),
      ).toBe(true);
    });
  });

  describe("given a claim that stopped beating", () => {
    const now = new Date("2026-08-05T12:00:00.000Z");
    const lastBeat = (agoMs: number) => new Date(now.getTime() - agoMs);

    /** @scenario "A claim that stopped reporting itself alive is taken over" */
    it("releases the claim once the tolerance is past", () => {
      expect(
        isClaimAbandoned({ heartbeatAt: lastBeat(TAKEOVER_AFTER_MS + 1), now }),
      ).toBe(true);
      expect(
        isClaimAbandoned({ heartbeatAt: lastBeat(10 * 60_000), now }),
      ).toBe(true);
    });
  });
});
