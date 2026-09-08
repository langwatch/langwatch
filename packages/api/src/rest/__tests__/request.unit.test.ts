/**
 * @vitest-environment node
 *
 * What happens to a REST request before its handler answers: the validator's
 * refusal reaching the boundary, the size the body cap is willing to trust, and
 * the receipt ledger behind `Idempotency-Key`.
 */
import { HandledError } from "@langwatch/handled-error";
import { Temporal, nowInstant } from "@langwatch/time";
import { Hono } from "hono";
import type { Context, ErrorHandler, Next } from "hono";
import { HTTPException } from "hono/http-exception";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { generateSpecs } from "hono-openapi";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import {
  bodyLimit,
  IdempotencyLedger,
  isClaimAbandoned,
  RECEIPT_TTL_MS,
  TAKEOVER_AFTER_MS,
  validator as zValidator,
  type IdempotencyReceiptCreateInput,
  type IdempotencyReceiptPersistence,
  type IdempotencyReceiptRecord,
  type IdempotencyReceiptUpdateInput,
  type IdempotencyResponseCipher,
} from "../request.ts";

// ─────────────────────────────────────────────────────────────────────────────
// The request validator, end to end through a real Hono app.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The boundary the validator's refusal has to reach, flattened the way
 * applications render it: `code` as `error`, `meta` flattened, `reasons`
 * only when non-empty. A failure that is not handled keeps its declared
 * status — the malformed-body catch must leave a route's own 400 alone
 * rather than reporting it as a parse failure.
 */
const handleError: ErrorHandler = (error, c) => {
  if (HandledError.isHandled(error)) {
    const { code, meta, reasons, ...rest } = error.serialize();
    return c.json(
      {
        ...rest,
        error: code,
        message: error.message,
        ...meta,
        ...(reasons.length > 0 ? { reasons } : {}),
      },
      error.httpStatus as ContentfulStatusCode,
    );
  }

  const { status } = error as Error & { status?: ContentfulStatusCode };
  return c.json({ error: error.message }, status ?? 500);
};

/**
 * These run against a REAL Hono app with the REAL error handler mounted, because
 * the whole point of the wrapper is what happens BETWEEN those two: the stock
 * validator answers a schema failure itself and `onError` never runs, so a test
 * that called the middleware in isolation would pass while the boundary stayed
 * broken.
 */
const schema = z.object({
  name: z.string().min(1),
  metric: z.enum(["latency", "cost"]),
  limit: z.number().max(100).optional(),
});

function appWith(hook?: Parameters<typeof zValidator>[2]) {
  const app = new Hono();
  app.onError(handleError);
  app.post("/", zValidator("json", schema, hook), (c) =>
    c.json({ ok: true, received: c.req.valid("json") }),
  );
  return app;
}

const post = (body: unknown, app = appWith()) =>
  app.request("/", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });

describe("the REST boundary's request validator", () => {
  describe("given a body that parses but fails the schema", () => {
    /** @scenario "A schema failure is a handled error, not the validator's own reply" */
    it("answers 422 with the handled-error code, not the validator's own 400", async () => {
      const res = await post({ name: "", metric: "latency" });

      expect(res.status).toBe(422);
      const body = await res.json();
      expect(body.error).toBe("validation_error");
    });

    /** @scenario "The expected values are structured data, not prose" */
    it("keeps the message to one sentence naming the target", async () => {
      const res = await post({ name: "", metric: "latency" });

      const body = await res.json();
      expect(body.message).toBe("The request body didn't match the expected shape.");
      expect(body.target).toBe("json");
    });

    /** @scenario "Every failing field is reported, not just the first" */
    it("reports every violation, not just the first", async () => {
      const res = await post({ name: "", metric: "nope", limit: 500 });

      const body = await res.json();
      expect(body.reasons).toHaveLength(3);
      expect(body.reasons.map((r: { meta: { field: string } }) => r.meta.field)).toEqual([
        "name",
        "metric",
        "limit",
      ]);
      expect(body.fields).toEqual(["name", "metric", "limit"]);
    });

    /** @scenario "Every failing field is reported, not just the first" */
    it("names each reason schema_failure and locates it", async () => {
      const res = await post({ name: "ok", metric: "nope" });

      const body = await res.json();
      const [reason] = body.reasons;
      expect(reason.code).toBe("schema_failure");
      expect(reason.meta.field).toBe("metric");
      expect(reason.meta.type).toBe("invalid_value");
    });

    /** @scenario "The expected values are structured data, not prose" */
    it("carries the permitted values as data rather than inlining them in prose", async () => {
      // The failure this guards: the permitted values used to be concatenated
      // into the message, which is what made it long enough to be truncated
      // before reaching a model — losing the one part worth having.
      const res = await post({ name: "ok", metric: "nope" });

      const body = await res.json();
      expect(body.reasons[0].meta.expected).toEqual(["latency", "cost"]);
      expect(body.reasons[0].meta.received).toBe("nope");
      expect(body.message).not.toContain("latency");
    });

    it("locates a failure with no path at the root rather than as an empty string", async () => {
      const res = await post([]);

      const body = await res.json();
      expect(body.reasons[0].meta.field).toBe("(root)");
    });

    it("attaches the remediation an agent reads", async () => {
      const res = await post({ name: "", metric: "latency" });

      const body = await res.json();
      expect(body.fault).toBe("customer");
      expect(body.tips.length).toBeGreaterThan(0);
    });
  });

  describe("given a schema that hands its accepted set to a refinement", () => {
    // A catalog lookup (valid evaluator types, real column names) can't be a
    // zod enum, so its failure is a `custom` issue — which knows nothing
    // about what the schema wanted. The schema says so itself via `params`,
    // and the boundary surfaces it exactly like an enum failure.
    const catalog = new Set(["catalog/a", "catalog/b"]);
    const catalogSchema = z.object({
      kind: z.string().superRefine((kind, ctx) => {
        if (!catalog.has(kind)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: "Unknown kind.",
            params: { expected: [...catalog], received: kind },
          });
        }
      }),
    });

    const appWithCatalog = () => {
      const app = new Hono();
      app.onError(handleError);
      app.post("/", zValidator("json", catalogSchema), (c) => c.json({ ok: true }));
      return app;
    };

    /** @scenario A schema can hand its accepted set to any validation failure */
    it("carries the refinement's accepted set as meta.expected, like an enum's", async () => {
      const res = await post({ kind: "catalog/nope" }, appWithCatalog());

      expect(res.status).toBe(422);
      const body = await res.json();
      expect(body.reasons[0].meta.expected).toEqual(["catalog/a", "catalog/b"]);
      expect(body.reasons[0].meta.received).toBe("catalog/nope");
    });

    it("leaves a refinement without params as bare as before", async () => {
      const bareSchema = z.object({
        kind: z.string().refine(() => false, { message: "no" }),
      });
      const app = new Hono();
      app.onError(handleError);
      app.post("/", zValidator("json", bareSchema), (c) => c.json({ ok: true }));

      const res = await post({ kind: "anything" }, app);

      const body = await res.json();
      expect(body.reasons[0].meta.expected).toBeUndefined();
      expect(body.reasons[0].meta.received).toBeUndefined();
    });
  });

  describe("given a body that never parsed at all", () => {
    /** @scenario "A body that never parsed is a different failure from one that did" */
    it("answers 400 with malformed_request, a different failure from a schema one", async () => {
      const res = await post("{ not json");

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toBe("malformed_request");
    });

    /** @scenario "A body that never parsed is a different failure from one that did" */
    it("reports no field reasons, because there was no document to have fields", async () => {
      const res = await post("{ not json");

      const body = await res.json();
      expect(body.reasons).toBeUndefined();
    });
  });

  describe("given the route supplies its own hook", () => {
    /** @scenario "A route's own validation hook still wins" */
    it("uses the hook's response unchanged", async () => {
      const app = appWith(((
        _result: unknown,
        c: { json: (body: unknown, status?: number) => unknown },
      ) => c.json({ mine: true }, 418)) as never);

      const res = await post({ name: "", metric: "latency" }, app);

      expect(res.status).toBe(418);
      expect(await res.json()).toEqual({ mine: true });
    });

    it("still raises the handled error when the hook declines to answer", async () => {
      const app = appWith((() => undefined) as never);

      const res = await post({ name: "", metric: "latency" }, app);

      expect(res.status).toBe(422);
    });
  });

  describe("given a valid body", () => {
    it("passes the parsed value through to the handler", async () => {
      const res = await post({ name: "ok", metric: "cost" });

      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({
        ok: true,
        received: { name: "ok", metric: "cost" },
      });
    });
  });

  describe("given the OpenAPI spec is generated from a route using it", () => {
    it("still publishes the request schema", async () => {
      // hono-openapi hangs the input schema off the middleware as an own symbol
      // property and reads it back at generation time. Wrapping the middleware
      // would silently drop it — the app would keep working and the published
      // API reference would quietly lose every request body.
      const spec = (await generateSpecs(appWith())) as {
        paths: Record<string, Record<string, { requestBody?: unknown }>>;
      };

      expect(spec.paths["/"]?.post?.requestBody).toBeDefined();
    });
  });

  describe("given the handler itself throws after validation passed", () => {
    it("leaves that failure alone rather than calling it malformed", async () => {
      // The guard on the malformed-body catch: it wraps the middleware, so a
      // 400 raised by the ROUTE would be misreported as a parse failure if the
      // wrapper did not track whether the handler had been entered.
      const app = new Hono();
      app.onError(handleError);
      app.post("/", zValidator("json", schema), () => {
        throw Object.assign(new Error("handler said no"), { status: 400 });
      });

      const res = await post({ name: "ok", metric: "cost" }, app);

      expect(res.status).toBe(400);
      expect((await res.json()).error).not.toBe("malformed_request");
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// The branch deciding whether the cap can trust the wire or must measure the
// body itself. Driven through the middleware directly since the header arrives
// unvalidated behind the route adapter. @see request.integration.test.ts
// ─────────────────────────────────────────────────────────────────────────────

const ECHO_URL = "http://127.0.0.1/echo";

/** A request whose `Content-Length` is whatever the caller says it is. */
function cappedRequest({
  payload,
  headers: extra = {},
}: {
  payload: string;
  headers?: Record<string, string>;
}): Request {
  const headers = new Headers({ "content-type": "application/json" });
  for (const [name, value] of Object.entries(extra)) headers.set(name, value);
  return new Request(ECHO_URL, { method: "POST", headers, body: payload });
}

/**
 * Drives the middleware over a stand-in for the Hono context, which is all of
 * it the middleware touches, and reports what the route would have seen.
 */
async function capped({ maxSize, incoming }: { maxSize: number; incoming: Request }): Promise<{
  status: number;
  reachedRoute: boolean;
  handedOn: Request;
  drained: boolean;
  body: string | null;
}> {
  const context = { req: { raw: incoming } };
  let reachedRoute = false;
  const next = (() => {
    reachedRoute = true;
    return Promise.resolve();
  }) as Next;

  let status = 200;
  try {
    await bodyLimit({ maxSize })(context as unknown as Context, next);
  } catch (error) {
    if (!(error instanceof HTTPException)) throw error;
    status = error.status;
  }

  const handedOn = context.req.raw;
  const drained = handedOn !== incoming;
  return {
    status,
    reachedRoute,
    handedOn,
    drained,
    body: drained ? await handedOn.text() : null,
  };
}

/** Everything a `Content-Length` can say that is not a size. */
const UNUSABLE_LENGTHS = {
  "a word": "abc",
  "a negative number": "-1",
  "an empty value": "",
  "exponent notation": "1e3",
  "a hexadecimal literal": "0x10",
  "a repeated header collapsed into a list": "12, 13",
  "a size past the safe-integer range": "9".repeat(20),
};

describe("the size the request body cap is willing to trust", () => {
  describe("given a Content-Length that is not a non-negative integer", () => {
    describe("when the body exceeds the cap", () => {
      for (const [description, value] of Object.entries(UNUSABLE_LENGTHS)) {
        it(`refuses a body whose length arrived as ${description}`, async () => {
          const result = await capped({
            maxSize: 16,
            incoming: cappedRequest({
              payload: "x".repeat(256),
              headers: { "content-length": value },
            }),
          });

          expect(result.status).toBe(413);
          expect(result.reachedRoute).toBe(false);
        });
      }
    });

    describe("when the body fits under the cap", () => {
      it("measures it by draining and hands the route the bytes back", async () => {
        const payload = JSON.stringify({ resourceSpans: [] });
        const result = await capped({
          maxSize: 1024,
          incoming: cappedRequest({
            payload,
            headers: { "content-length": "abc" },
          }),
        });

        expect(result.status).toBe(200);
        expect(result.reachedRoute).toBe(true);
        expect(result.drained).toBe(true);
        expect(result.body).toBe(payload);
      });
    });
  });

  describe("given no Content-Length at all", () => {
    describe("when the body fits under the cap", () => {
      it("drains it and hands the route the bytes back", async () => {
        const payload = JSON.stringify({ resourceSpans: [] });
        const result = await capped({
          maxSize: 1024,
          incoming: cappedRequest({ payload }),
        });

        expect(result.status).toBe(200);
        expect(result.reachedRoute).toBe(true);
        expect(result.drained).toBe(true);
        expect(result.body).toBe(payload);
      });
    });

    describe("when the body exceeds the cap", () => {
      it("refuses it", async () => {
        const result = await capped({
          maxSize: 16,
          incoming: cappedRequest({ payload: "x".repeat(256) }),
        });

        expect(result.status).toBe(413);
        expect(result.reachedRoute).toBe(false);
      });
    });
  });

  describe("given a Transfer-Encoding alongside a Content-Length", () => {
    describe("when the body fits under the cap", () => {
      it("believes the transfer encoding and measures the body itself", async () => {
        const payload = JSON.stringify({ resourceSpans: [] });
        const result = await capped({
          maxSize: 1024,
          incoming: cappedRequest({
            payload,
            headers: { "content-length": "0", "transfer-encoding": "chunked" },
          }),
        });

        expect(result.drained).toBe(true);
        expect(result.body).toBe(payload);
      });
    });
  });

  describe("given a Content-Length that is a non-negative integer", () => {
    describe("when it exceeds the cap", () => {
      it("refuses the request without reading a byte of it", async () => {
        const incoming = cappedRequest({
          payload: "x".repeat(256),
          headers: { "content-length": "256" },
        });

        const result = await capped({ maxSize: 16, incoming });

        expect(result.status).toBe(413);
        expect(result.reachedRoute).toBe(false);
        expect(incoming.bodyUsed).toBe(false);
      });
    });

    describe("when it fits under the cap", () => {
      it("passes the request straight through, still unread", async () => {
        const incoming = cappedRequest({
          payload: "x".repeat(8),
          headers: { "content-length": "8" },
        });

        const result = await capped({ maxSize: 1024, incoming });

        expect(result.reachedRoute).toBe(true);
        expect(result.drained).toBe(false);
        expect(incoming.bodyUsed).toBe(false);
      });
    });

    describe("when it declares an empty body", () => {
      it("passes the request straight through", async () => {
        const result = await capped({
          maxSize: 16,
          incoming: cappedRequest({
            payload: "",
            headers: { "content-length": "0" },
          }),
        });

        expect(result.reachedRoute).toBe(true);
        expect(result.drained).toBe(false);
      });
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// The receipt ledger behind `Idempotency-Key`.
//
// Driven against an in-memory receipt store that keeps the ONE property the
// protocol is built on: the unique index over (scopeId, key), so a second insert
// under a live key loses rather than creating alongside the first. Everything
// the ledger decides — replay, refusal, takeover — is read off that loss.
//
// @see specs/ai-gateway/idempotency.feature
// ─────────────────────────────────────────────────────────────────────────────

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
 * with a branch these scenarios exist to rule out.
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
      return Response.json(body, { status: 201 });
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
      const call = {
        operation: "gateway.v1.budgets.create",
        scopeId: SCOPE,
        key: KEY,
        validatedBody: { limit: 10 },
      };

      const original = await ledger.run({ ...call, handler: first.handler });
      const second = countingHandler({ id: "budget_2", secret: "a different one" });
      const replay = await ledger.run({ ...call, handler: second.handler });

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
      const call = {
        operation: "gateway.v1.budgets.create",
        scopeId: SCOPE,
        key: KEY,
      };

      await ledger.run({
        ...call,
        validatedBody: { limit: 10 },
        handler: countingHandler({ id: "budget_1" }).handler,
      });
      const changed = countingHandler({ id: "budget_2" });

      const refusal = await refusalFrom(
        ledger.run({ ...call, validatedBody: { limit: 99 }, handler: changed.handler }),
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
      const call = {
        operation: "gateway.v1.budgets.create",
        scopeId: SCOPE,
        key: KEY,
        validatedBody: { limit: 10 },
      };

      const slow = ledger.run({
        ...call,
        handler: async () => {
          runs++;
          await held;
          return Response.json({ id: "budget_1" }, { status: 201 });
        },
      });
      const retry = refusalFrom(
        ledger.run({
          ...call,
          handler: async () => {
            runs++;
            return Response.json({ id: "budget_2" }, { status: 201 });
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
      const call = {
        operation: "gateway.v1.budgets.create",
        scopeId: SCOPE,
        key: KEY,
        validatedBody: { limit: 10 },
      };

      await expect(
        ledger.run({
          ...call,
          handler: () => Promise.reject(new Error("the database blinked")),
        }),
      ).rejects.toThrow("the database blinked");
      const retry = countingHandler({ id: "budget_1" });
      const outcome = await ledger.run({ ...call, handler: retry.handler });

      expect(outcome).toMatchObject({ isReplayed: false, status: 201 });
      expect(retry.runs).toBe(1);
    });
  });

  describe("given a claim made long ago", () => {
    /** @scenario "Takeover turns on the last beat, not on the claim's age" */
    it("is not abandoned while it is still reporting itself alive", () => {
      const now = nowInstant();
      const longAfterAnyFixedWindow = now.subtract({ milliseconds: RECEIPT_TTL_MS - 1_000 });

      expect(isClaimAbandoned({ heartbeatAt: now.subtract({ milliseconds: 1_000 }), now })).toBe(
        false,
      );
      expect(isClaimAbandoned({ heartbeatAt: longAfterAnyFixedWindow, now })).toBe(true);
      expect(
        isClaimAbandoned({
          heartbeatAt: now.subtract({ milliseconds: TAKEOVER_AFTER_MS + 1 }),
          now,
        }),
      ).toBe(true);
    });
  });

  describe("given a claim that stopped beating", () => {
    const now = Temporal.Instant.from("2026-08-05T12:00:00.000Z");
    const lastBeat = (agoMs: number) => now.subtract({ milliseconds: agoMs });

    /** @scenario "A claim that stopped reporting itself alive is taken over" */
    it("releases the claim once the tolerance is past", () => {
      expect(isClaimAbandoned({ heartbeatAt: lastBeat(TAKEOVER_AFTER_MS + 1), now })).toBe(true);
      expect(isClaimAbandoned({ heartbeatAt: lastBeat(10 * 60_000), now })).toBe(true);
    });
  });
});
