/**
 * `withIdempotency` as a chain verb: the framework reads the key, dispatches
 * through the ledger, writes a replay from the stored bytes and documents both
 * halves — so a family cannot wire two of the three helpers by hand.
 */

// Spec: packages/api/specs/endpoint-capabilities.feature.

import { describe, expect, it } from "vitest";
import { z } from "zod";

import { createTestService as createService } from "./test-service.js";
import {
  IDEMPOTENCY_KEY_HEADER,
  IDEMPOTENT_REPLAY_HEADER,
  type IdempotentOutcome,
  type IdempotentRunner,
} from "../idempotency.js";

const output = z.object({ id: z.string() });

/** A ledger with the one behaviour the routes care about: replay by key. */
function ledger() {
  const receipts = new Map<string, { status: number; serializedBody: string }>();
  const asked: { operation: string; scopeId: string; key: string | null }[] = [];
  const runner: IdempotentRunner = async ({ operation, scopeId, key, handler }) => {
    asked.push({ operation, scopeId, key });
    const receiptKey = key === null ? null : `${operation}:${scopeId}:${key}`;
    const stored = receiptKey === null ? undefined : receipts.get(receiptKey);
    if (stored) return { isReplayed: true, ...stored } satisfies IdempotentOutcome<unknown>;
    const executed = await handler();
    if (receiptKey !== null) {
      receipts.set(receiptKey, {
        status: executed.status,
        serializedBody: JSON.stringify(executed.body),
      });
    }
    return { isReplayed: false, ...executed };
  };
  return { asked, runner };
}

function serviceUnder({ runner }: { runner?: IdempotentRunner }) {
  let created = 0;
  const app = createService({
    name: "toy-creates",
    logger: false,
    tracer: false,
    ...(runner ? { idempotency: runner } : {}),
  })
    .registerRoute(
      "post",
      "/things",
      "2026-08-07",
      async (_c, _input: { name: string }) => ({ id: `thing-${++created}` }),
      (b) =>
        b
          .withInput(z.object({ name: z.string() }))
          .withOutput(output)
          .withStatus(201)
          .withIdempotency({
            operation: "toy.things.create",
            scope: (c) => c.req.header("x-toy-scope") ?? "scope-1",
          }),
    )
    .build();
  return { app, created: () => created };
}

const post = (key?: string) => ({
  method: "POST",
  body: JSON.stringify({ name: "a" }),
  headers: {
    "content-type": "application/json",
    ...(key ? { [IDEMPOTENCY_KEY_HEADER]: key } : {}),
  },
});

describe("withIdempotency", () => {
  describe("given two requests carrying the same key", () => {
    /** @scenario "A create declared replayable answers a retry from its receipt" */
    it("runs the create once and answers the retry from the stored bytes", async () => {
      const { asked, runner } = ledger();
      const service = serviceUnder({ runner });

      const first = await service.app.request(
        "/api/toy-creates/2026-08-07/things",
        post("key-123456"),
      );
      const retry = await service.app.request(
        "/api/toy-creates/2026-08-07/things",
        post("key-123456"),
      );

      expect(first.status).toBe(201);
      expect(await first.json()).toEqual({ id: "thing-1" });
      expect(first.headers.get(IDEMPOTENT_REPLAY_HEADER)).toBeNull();

      expect(retry.status).toBe(201);
      expect(await retry.json()).toEqual({ id: "thing-1" });
      expect(retry.headers.get(IDEMPOTENT_REPLAY_HEADER)).toBe("true");

      expect(service.created()).toBe(1);
      expect(asked).toEqual([
        { operation: "toy.things.create", scopeId: "scope-1", key: "key-123456" },
        { operation: "toy.things.create", scopeId: "scope-1", key: "key-123456" },
      ]);
    });
  });

  describe("given the same key in a different tenancy", () => {
    /** @scenario "A create declared replayable answers a retry from its receipt" */
    it("runs the create again, because the key is unique within its scope", async () => {
      const { runner } = ledger();
      const service = serviceUnder({ runner });

      await service.app.request("/api/toy-creates/2026-08-07/things", post("key-123456"));
      const other = await service.app.request("/api/toy-creates/2026-08-07/things", {
        ...post("key-123456"),
        headers: { ...post("key-123456").headers, "x-toy-scope": "scope-2" },
      });

      expect(await other.json()).toEqual({ id: "thing-2" });
    });
  });

  describe("given no key at all", () => {
    /** @scenario "A create declared replayable answers a retry from its receipt" */
    it("behaves exactly as an unkeyed create, writing no receipt", async () => {
      const { asked, runner } = ledger();
      const service = serviceUnder({ runner });

      const first = await service.app.request("/api/toy-creates/2026-08-07/things", post());
      const second = await service.app.request("/api/toy-creates/2026-08-07/things", post());

      expect(await first.json()).toEqual({ id: "thing-1" });
      expect(await second.json()).toEqual({ id: "thing-2" });
      expect(asked.every((entry) => entry.key === null)).toBe(true);
    });
  });

  describe("given a key too short to be plausibly unique", () => {
    /** @scenario "A create declared replayable answers a retry from its receipt" */
    it("refuses the request rather than silently ignoring the key", async () => {
      const { runner } = ledger();
      const service = serviceUnder({ runner });

      const response = await service.app.request(
        "/api/toy-creates/2026-08-07/things",
        post("short"),
      );

      expect(response.status).toBe(422);
      expect(service.created()).toBe(0);
    });
  });

  describe("given the capability is declared without the port", () => {
    /** @scenario "A capability declared without its port fails the build" */
    it("refuses to build, naming the port to pass", () => {
      expect(() => serviceUnder({})).toThrow(
        /declares withIdempotency but the service has no "idempotency" port/,
      );
    });

    /** @scenario "A capability declared without its port fails the build" */
    it("refuses it on a read, which is already safe to retry", () => {
      const { runner } = ledger();
      expect(() =>
        createService({ name: "toy-reads", logger: false, tracer: false, idempotency: runner })
          .registerRoute(
            "get",
            "/things",
            "2026-08-07",
            async () => ({ id: "a" }),
            (b) =>
              b.withOutput(output).withIdempotency({
                operation: "toy.things.read",
                scope: () => "scope-1",
              }),
          )
          .build(),
      ).toThrow(/declares withIdempotency, which belongs to a create/);
    });
  });
});

describe("a replayable create declaring a pre-flight", () => {
  /** @scenario "A replayable create re-checks the authorization a replay would otherwise skip" */
  it("runs the pre-flight on the replay too, while the handler runs once", async () => {
    const { runner } = ledger();
    const preflights: unknown[] = [];
    let created = 0;
    const app = createService({
      name: "toy-guarded-creates",
      logger: false,
      tracer: false,
      idempotency: runner,
    })
      .registerRoute(
        "post",
        "/things",
        "2026-08-07",
        async (_c, _input: { name: string }) => ({ id: `thing-${++created}` }),
        (b) =>
          b
            .withInput(z.object({ name: z.string() }))
            .withOutput(output)
            .withStatus(201)
            .withIdempotency({
              operation: "toy.guarded.create",
              scope: () => "scope-1",
              preflight: (_c, input) => void preflights.push(input),
            }),
      )
      .build();

    const first = await app.request(
      "/api/toy-guarded-creates/2026-08-07/things",
      post("key-abc123"),
    );
    const retry = await app.request(
      "/api/toy-guarded-creates/2026-08-07/things",
      post("key-abc123"),
    );

    expect(first.status).toBe(201);
    expect(retry.status).toBe(201);
    expect(created).toBe(1);
    expect(preflights).toEqual([{ name: "a" }, { name: "a" }]);
  });
});
