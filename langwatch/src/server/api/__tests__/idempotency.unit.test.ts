/**
 * The parts of `Idempotency-Key` handling that need no storage: reading the
 * header, and deciding whether two bodies are the same body.
 *
 * Everything that turns on a stored receipt (replay, the pending window,
 * expiry, fingerprint conflict) is asserted against real Postgres in
 * `src/app/api/gateway-platform/__tests__/gateway-platform-api.integration.test.ts`,
 * because the unique index is what implements the serialisation and a fake of
 * it would be asserting the fake.
 */
import { HandledError } from "@langwatch/handled-error";
import { describe, expect, it } from "vitest";

import {
  fingerprintRequestBody,
  MAX_KEY_LENGTH,
  MIN_KEY_LENGTH,
  PENDING_TAKEOVER_MS,
  RECEIPT_TTL_MS,
  readIdempotencyKey,
  withIdempotency,
} from "../idempotency";

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
  it("ignores the order the caller's serialiser emitted keys in", () => {
    const one = fingerprintRequestBody({
      name: "monthly",
      window: "month",
      limit_usd: 25,
    });
    const other = fingerprintRequestBody({
      limit_usd: 25,
      window: "month",
      name: "monthly",
    });
    expect(one).toBe(other);
  });

  it("ignores key order at every depth", () => {
    const one = fingerprintRequestBody({
      scope: { kind: "project", project_id: "proj-1" },
      metadata: { b: 2, a: 1 },
    });
    const other = fingerprintRequestBody({
      metadata: { a: 1, b: 2 },
      scope: { project_id: "proj-1", kind: "project" },
    });
    expect(one).toBe(other);
  });

  it("treats a changed value as a different request", () => {
    const one = fingerprintRequestBody({ limit_usd: 25 });
    const other = fingerprintRequestBody({ limit_usd: 26 });
    expect(one).not.toBe(other);
  });

  it("treats array order as meaningful", () => {
    // Order carries meaning in the wire schemas that take lists (scopes,
    // enabled_events), so two orderings are two different requests.
    expect(fingerprintRequestBody({ events: ["a", "b"] })).not.toBe(
      fingerprintRequestBody({ events: ["b", "a"] }),
    );
  });

  it("distinguishes a missing key from an explicit null", () => {
    expect(fingerprintRequestBody({ name: "x" })).not.toBe(
      fingerprintRequestBody({ name: "x", description: null }),
    );
  });

  it("is a sha256 hex digest", () => {
    expect(fingerprintRequestBody({ a: 1 })).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("withIdempotency without a key", () => {
  it("runs the handler and touches no storage", async () => {
    const outcome = await withIdempotency({
      prisma: forbiddenPrisma,
      scopeId: "proj-1",
      key: null,
      validatedBody: { name: "monthly" },
      handler: async () => ({ status: 201, body: { budget: { id: "bg-1" } } }),
    });

    expect(outcome).toEqual({
      status: 201,
      body: { budget: { id: "bg-1" } },
      replayed: false,
    });
  });

  it("lets a handler failure through untouched", async () => {
    const boom = new Error("service refused");
    await expect(
      withIdempotency({
        prisma: forbiddenPrisma,
        scopeId: "proj-1",
        key: null,
        validatedBody: {},
        handler: () => Promise.reject(boom),
      }),
    ).rejects.toBe(boom);
  });
});

describe("the receipt windows", () => {
  it("answers for 24 hours and believes a pending row for 60 seconds", () => {
    // Pinned because both numbers are quoted in the OpenAPI description and
    // in the copy a caller reads when it is told to retry shortly.
    expect(RECEIPT_TTL_MS).toBe(24 * 60 * 60 * 1000);
    expect(PENDING_TAKEOVER_MS).toBe(60_000);
  });
});
