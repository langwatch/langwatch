/**
 * The parts of `Idempotency-Key` handling that need no storage: reading the
 * header, deciding whether two bodies are the same body, whether a claim has
 * gone quiet long enough to be taken over, and whether a receipt can still be
 * read back at all.
 *
 * Everything that turns on a stored receipt (replay, expiry, fingerprint
 * conflict, and a takeover actually happening) is asserted against real
 * Postgres in
 * `src/app/api/gateway-platform/__tests__/gateway-platform-api.integration.test.ts`,
 * because the unique index is what implements the serialisation and a fake of
 * it would be asserting the fake.
 */

import crypto from "node:crypto";
import { HandledError } from "@langwatch/handled-error";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  IdempotencyReceipt,
  PrismaClient,
} from "~/generated/prisma/client";

import { encrypt } from "~/utils/encryption";

import {
  fingerprintRequestBody,
  HEARTBEAT_INTERVAL_MS,
  isClaimAbandoned,
  MAX_KEY_LENGTH,
  MIN_KEY_LENGTH,
  RECEIPT_TTL_MS,
  readIdempotencyKey,
  readStoredBody,
  serializeResponseBody,
  TAKEOVER_AFTER_MS,
  withIdempotency,
} from "../idempotency";

const { logSpy } = vi.hoisted(() => ({
  logSpy: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock("@langwatch/observability", () => ({
  createLogger: () => logSpy,
}));

beforeEach(() => {
  vi.clearAllMocks();
});

/** A prisma that fails loudly if anything reaches for it. */
const forbiddenPrisma = new Proxy(
  {},
  {
    get(_target, property) {
      throw new Error(
        `the unkeyed path must not touch storage, but read prisma.${String(property)}`,
      );
    },
  },
) as never;

describe("readIdempotencyKey", () => {
  it("reads an absent header as no key at all", () => {
    expect(readIdempotencyKey(undefined)).toBeNull();
    expect(readIdempotencyKey(null)).toBeNull();
  });

  it("trims surrounding whitespace off the key", () => {
    expect(readIdempotencyKey("  order-4711  ")).toBe("order-4711");
  });

  it("accepts the shortest and longest permitted keys", () => {
    const shortest = "a".repeat(MIN_KEY_LENGTH);
    const longest = "a".repeat(MAX_KEY_LENGTH);
    expect(readIdempotencyKey(shortest)).toBe(shortest);
    expect(readIdempotencyKey(longest)).toBe(longest);
  });

  it.each([
    ["one character short", "a".repeat(MIN_KEY_LENGTH - 1)],
    ["one character long", "a".repeat(MAX_KEY_LENGTH + 1)],
    ["empty", ""],
    ["whitespace only", "     "],
  ])("refuses a key that is %s", (_name, raw) => {
    let thrown: unknown;
    try {
      readIdempotencyKey(raw);
    } catch (error) {
      thrown = error;
    }

    expect(HandledError.isHandled(thrown)).toBe(true);
    const handled = thrown as HandledError;
    // The canonical families answer this code 400, so a bad key reads to a
    // caller exactly like a field its schema rejected.
    expect(handled.code).toBe("validation_error");
    expect(handled.meta?.target).toBe("header");
    expect(handled.meta?.fields).toEqual(["Idempotency-Key"]);
  });

  it("counts length after trimming, not before", () => {
    // Seven characters padded out to well over the floor. If the bounds were
    // checked on the raw value this would be accepted and then stored under a
    // key too short to be plausibly unique.
    expect(() => readIdempotencyKey(`   ${"a".repeat(7)}   `)).toThrow();
  });
});

describe("fingerprintRequestBody", () => {
  const OPERATION = "gateway.v1.budgets.create";
  const fingerprint = (body: unknown) =>
    fingerprintRequestBody({ operation: OPERATION, body });

  it("ignores the order the caller's serialiser emitted keys in", () => {
    const one = fingerprint({
      name: "monthly",
      window: "month",
      limit_usd: 25,
    });
    const other = fingerprint({
      limit_usd: 25,
      window: "month",
      name: "monthly",
    });
    expect(one).toBe(other);
  });

  it("ignores key order at every depth", () => {
    const one = fingerprint({
      scope: { kind: "project", project_id: "proj-1" },
      metadata: { b: 2, a: 1 },
    });
    const other = fingerprint({
      metadata: { a: 1, b: 2 },
      scope: { project_id: "proj-1", kind: "project" },
    });
    expect(one).toBe(other);
  });

  it("treats a changed value as a different request", () => {
    const one = fingerprint({ limit_usd: 25 });
    const other = fingerprint({ limit_usd: 26 });
    expect(one).not.toBe(other);
  });

  it("treats array order as meaningful", () => {
    // Order carries meaning in the wire schemas that take lists (scopes,
    // enabled_events), so two orderings are two different requests.
    expect(fingerprint({ events: ["a", "b"] })).not.toBe(
      fingerprint({ events: ["b", "a"] }),
    );
  });

  it("distinguishes a missing key from an explicit null", () => {
    expect(fingerprint({ name: "x" })).not.toBe(
      fingerprint({ name: "x", description: null }),
    );
  });

  it("is a sha256 hex digest", () => {
    expect(fingerprint({ a: 1 })).toMatch(/^[0-9a-f]{64}$/);
  });

  describe("when the same body is sent to two different creates", () => {
    /** @scenario "One key cannot answer for two different creates" */
    it("fingerprints them apart", () => {
      const body = { name: "shared" };
      expect(
        fingerprintRequestBody({
          operation: "gateway.v1.virtual-keys.create",
          body,
        }),
      ).not.toBe(
        fingerprintRequestBody({
          operation: "gateway.v1.cache-rules.create",
          body,
        }),
      );
    });
  });
});

describe("withIdempotency without a key", () => {
  it("runs the handler and touches no storage", async () => {
    const outcome = await withIdempotency({
      prisma: forbiddenPrisma,
      operation: "gateway.v1.budgets.create",
      scopeId: "proj-1",
      key: null,
      validatedBody: { name: "monthly" },
      handler: async () => ({ status: 201, body: { budget: { id: "bg-1" } } }),
    });

    expect(outcome).toEqual({
      status: 201,
      body: { budget: { id: "bg-1" } },
      isReplayed: false,
    });
  });

  it("lets a handler failure through untouched", async () => {
    const boom = new Error("service refused");
    await expect(
      withIdempotency({
        prisma: forbiddenPrisma,
        operation: "gateway.v1.budgets.create",
        scopeId: "proj-1",
        key: null,
        validatedBody: {},
        handler: () => Promise.reject(boom),
      }),
    ).rejects.toBe(boom);
  });
});

describe("readStoredBody", () => {
  const receiptWith = (responseBody: string | null): IdempotencyReceipt =>
    ({
      id: "rcpt-1",
      scopeId: "proj-1",
      key: "order-4711",
      requestFingerprint: "f".repeat(64),
      responseStatus: 201,
      responseBody,
      createdAt: new Date(),
      expiresAt: new Date(Date.now() + 60_000),
    }) as IdempotencyReceipt;

  /**
   * A well-formed AES-256-GCM ciphertext in the shared format, under a key
   * that is not this deployment's. Exactly what CREDENTIALS_SECRET having been
   * rotated inside a receipt's 24 hours leaves behind: authentic bytes that
   * this process can no longer read.
   */
  function encryptUnderAnotherKey(text: string): string {
    const key = crypto.randomBytes(32);
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
    const body = cipher.update(text, "utf8", "hex") + cipher.final("hex");
    return `${iv.toString("hex")}:${body}:${cipher.getAuthTag().toString("hex")}`;
  }

  it("reads back exactly what was stored", () => {
    const bytes = serializeResponseBody({ budget: { id: "bg-1", limit: 5 } });
    expect(readStoredBody(receiptWith(encrypt(bytes)))).toBe(bytes);
  });

  it("drops a receipt encrypted under a different key", () => {
    const foreign = encryptUnderAnotherKey('{"budget":{"id":"bg-1"}}');
    // Null rather than a throw: the caller treats it like an expired receipt
    // and runs the create fresh, which is better than refusing a create the
    // caller can never otherwise make.
    expect(readStoredBody(receiptWith(foreign))).toBeNull();
  });

  it("drops a receipt whose stored body is not the expected format", () => {
    expect(readStoredBody(receiptWith('{"budget":{"id":"bg-1"}}'))).toBeNull();
  });

  it("reads a missing body as nothing to replay", () => {
    expect(readStoredBody(receiptWith(null))).toBeNull();
  });

  it("does not store the response as readable text", () => {
    const bytes = serializeResponseBody({ secret: "vk-lw-supersecret" });
    const stored = encrypt(bytes);
    expect(stored).not.toContain("vk-lw-supersecret");
    expect(stored).toMatch(/^[0-9a-f]+:[0-9a-f]+:[0-9a-f]+$/);
  });
});

describe("isClaimAbandoned", () => {
  const now = new Date("2026-08-05T12:00:00.000Z");
  const lastBeat = (agoMs: number) => new Date(now.getTime() - agoMs);

  describe("given a claim that is still reporting itself alive", () => {
    /** @scenario "A retry sent while the original is still running is refused" */
    it("holds the claim while the beats keep arriving", () => {
      expect(isClaimAbandoned({ heartbeatAt: lastBeat(0), now })).toBe(false);
      expect(
        isClaimAbandoned({ heartbeatAt: lastBeat(HEARTBEAT_INTERVAL_MS), now }),
      ).toBe(false);
      // Silent for the whole tolerance and not a millisecond more: the beat
      // that would have cleared it may simply be in flight.
      expect(
        isClaimAbandoned({ heartbeatAt: lastBeat(TAKEOVER_AFTER_MS), now }),
      ).toBe(false);
    });
  });

  describe("given a claim that stopped beating", () => {
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

  describe("given a slow request that claimed the key long ago", () => {
    /** @scenario "Takeover turns on the last beat, not on the claim's age" */
    it("holds the claim however old it is, because it is still beating", () => {
      // An hour into a handler that is waiting on a lock, beating a second
      // ago. Any rule that reads the claim's age declares this dead and lets a
      // second request create alongside a first that is still going to write.
      const claimedAnHourAgo = {
        heartbeatAt: lastBeat(1_000),
        now,
      };
      expect(isClaimAbandoned(claimedAnHourAgo)).toBe(false);
    });
  });
});

describe("the receipt windows", () => {
  it("answers for 24 hours and gives a quiet claim four beats", () => {
    // The lifetime is pinned because it is quoted in the OpenAPI description.
    expect(RECEIPT_TTL_MS).toBe(24 * 60 * 60 * 1000);
    expect(HEARTBEAT_INTERVAL_MS).toBe(5_000);
    expect(TAKEOVER_AFTER_MS).toBe(20_000);
    // Below two intervals a single swallowed beat reads as a death, which is
    // the failure this whole mechanism exists to stop being possible.
    expect(TAKEOVER_AFTER_MS).toBeGreaterThanOrEqual(3 * HEARTBEAT_INTERVAL_MS);
  });
});

describe("the writes a claim holder makes", () => {
  const RECEIPT_ID = "rcpt-1";

  interface PrismaCall {
    where?: Record<string, unknown>;
    data?: Record<string, unknown>;
  }

  /**
   * A prisma that records what it was asked to write and reports how many rows
   * each write matched. `matchedRows: 0` is a claim that was taken over while
   * this request's handler was still running.
   */
  function recordingPrisma({ matchedRows }: { matchedRows: number }) {
    const created: PrismaCall[] = [];
    const updated: PrismaCall[] = [];
    const deleted: PrismaCall[] = [];

    const prisma = {
      idempotencyReceipt: {
        create: (args: PrismaCall) => {
          created.push(args);
          return Promise.resolve({ id: RECEIPT_ID });
        },
        updateMany: (args: PrismaCall) => {
          updated.push(args);
          return Promise.resolve({ count: matchedRows });
        },
        deleteMany: (args: PrismaCall) => {
          deleted.push(args);
          return Promise.resolve({ count: matchedRows });
        },
      },
    } as unknown as PrismaClient;

    return { prisma, created, updated, deleted };
  }

  const run = (prisma: PrismaClient, handler: () => Promise<never> | never) =>
    withIdempotency({
      prisma,
      operation: "gateway.v1.budgets.create",
      scopeId: "proj-1",
      key: "order-4711",
      validatedBody: { name: "monthly" },
      handler: handler as never,
    });

  const succeeds = () =>
    Promise.resolve({ status: 201, body: { budget: { id: "bg-1" } } });

  describe("when the claim is still the one this request took", () => {
    it("stores the response against the claim it holds", async () => {
      const { prisma, created, updated } = recordingPrisma({ matchedRows: 1 });

      await run(prisma, succeeds as never);

      const claimId = created[0]?.data?.claimId;
      expect(typeof claimId).toBe("string");
      // The fence, spelled on the write itself rather than checked before it,
      // so no gap exists between reading the claim and writing under it.
      expect(updated).toHaveLength(1);
      expect(updated[0]?.where).toEqual({ id: RECEIPT_ID, claimId });
      expect(logSpy.error).not.toHaveBeenCalled();
    });
  });

  describe("when the claim was taken over while the handler ran", () => {
    it("leaves the new claim's receipt alone and says so", async () => {
      const { prisma, updated, deleted } = recordingPrisma({ matchedRows: 0 });

      const outcome = await run(prisma, succeeds as never);

      // The resource was created, so the request answers for it. What it
      // cannot do is claim the key back.
      expect(outcome).toMatchObject({ status: 201, isReplayed: false });
      // One fenced attempt and no unfenced fallback: a second write without
      // the claimId would overwrite the receipt of the request that replaced
      // this one, and hide the double create instead of reporting it.
      expect(updated).toHaveLength(1);
      expect(deleted).toHaveLength(0);
      expect(logSpy.error).toHaveBeenCalledTimes(1);
      expect(logSpy.error.mock.calls[0]?.[1]).toContain(
        "may now stand for a second resource",
      );
    });

    it("releases nothing when its handler failed", async () => {
      const boom = new Error("service refused");
      const { prisma, created, deleted } = recordingPrisma({ matchedRows: 0 });

      await expect(
        run(prisma, () => Promise.reject(boom) as never),
      ).rejects.toBe(boom);

      // A failed create has nothing to store, but it must still not delete a
      // row another request is now working under.
      expect(deleted).toHaveLength(1);
      expect(deleted[0]?.where).toEqual({
        id: RECEIPT_ID,
        claimId: created[0]?.data?.claimId,
      });
      expect(logSpy.warn).toHaveBeenCalledTimes(1);
    });
  });
});
