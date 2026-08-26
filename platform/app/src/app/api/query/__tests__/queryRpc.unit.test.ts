/**
 * The JSON-RPC envelope, exercised without a database.
 *
 * The integration test drives the door end to end and needs ClickHouse,
 * Postgres and a seeded tenant. Everything asserted here is protocol — codes,
 * ids, the shape of a reply — and none of it depends on what LangWatchQL does,
 * so it belongs in a test that runs anywhere. That separation is why `rpc.ts`
 * is its own module rather than living inside the route.
 *
 * The property under test throughout: **a client must be able to match a reply
 * to the call it made, and branch on why a call failed** — which is all a
 * JSON-RPC client has, and both halves are easy to lose in an error path.
 *
 * @see ../[[...route]]/rpc
 * @see https://github.com/langwatch/langwatch/issues/7565#issuecomment-5424087900
 */

import { HandledError } from "@langwatch/handled-error";
import { type Context, Hono } from "hono";
import { describe, expect, it } from "vitest";

import { canonicalErrorFor } from "~/app/api/shared/canonical-error";
import {
  RequestValidationError,
  validator as zValidator,
} from "~/server/api/validation";
import {
  methodNotFound,
  recordRpcId,
  RPC_CODES,
  rpcErrorBody,
  rpcIdOf,
  rpcResultBody,
} from "../[[...route]]/rpc";
import { queryRpcRequestSchema } from "../[[...route]]/schemas";

/** A context stub carrying only what the envelope builders read off it. */
function contextWith(vars: Record<string, unknown>): Context {
  return { get: (key: string) => vars[key] } as unknown as Context;
}

/** The canonical body shape the error builder consumes. */
function canonicalBody(code: string, message: string) {
  return { error: { type: "x", code, message } };
}

function errorBodyFor(error: unknown, id?: unknown) {
  return rpcErrorBody({
    error,
    canonical: canonicalBody("some_code", "Some message."),
    c: contextWith(id === undefined ? {} : { rpcId: id }),
  }) as { jsonrpc: string; id?: unknown; error: { code: number; data: unknown } };
}

describe("given a JSON-RPC reply is being built", () => {
  describe("when the request carried an id", () => {
    it("echoes it on success, so the client can match the reply to its call", () => {
      const body = rpcResultBody({ id: 7, result: { ok: true } }) as {
        jsonrpc: string;
        id: unknown;
      };

      expect(body.jsonrpc).toBe("2.0");
      expect(body.id).toBe(7);
    });

    /**
     * The failure case is the one that actually breaks clients: an error reply
     * with no id cannot be routed back to the caller that is awaiting it, so a
     * client multiplexing calls hangs rather than fails.
     */
    it("echoes it on failure too", () => {
      expect(errorBodyFor(new Error("boom"), 7).id).toBe(7);
    });

    it("preserves a string id as a string, not coerced to a number", () => {
      expect(rpcResultBody({ id: "7", result: null })).toMatchObject({ id: "7" });
      expect(errorBodyFor(new Error("boom"), "7").id).toBe("7");
    });

    /** `null` is a legal id and distinct from "no id was sent". */
    it("distinguishes an explicit null id from an absent one", () => {
      expect(rpcResultBody({ id: null, result: null })).toHaveProperty("id", null);
      expect(rpcResultBody({ id: undefined, result: null })).not.toHaveProperty(
        "id",
      );
    });
  });

  describe("when the request never parsed", () => {
    it("omits the id rather than inventing one", () => {
      expect(errorBodyFor(new Error("boom"))).not.toHaveProperty("id");
    });
  });
});

describe("given an error is being classified for the wire", () => {
  /**
   * The distinction a client branches on. An unknown method is a caller
   * mistake it can fix by reading the document; a server error is not. Folding
   * both into -32603 would make them indistinguishable.
   */
  it("reports an unknown method as method-not-found, not a server error", () => {
    const body = errorBodyFor(methodNotFound("query.nope"));
    expect(body.error.code).toBe(RPC_CODES.METHOD_NOT_FOUND);
  });

  it("reports a malformed envelope as an invalid request", () => {
    const body = errorBodyFor(
      new RequestValidationError({
        target: "json",
        violations: [{ field: "method", type: "invalid_enum_value", message: "no" }],
      }),
    );
    expect(body.error.code).toBe(RPC_CODES.INVALID_REQUEST);
  });

  it("falls back to a server error for anything unrecognised", () => {
    expect(errorBodyFor(new Error("boom")).error.code).toBe(
      RPC_CODES.SERVER_ERROR,
    );
  });

  /**
   * The reason application failures do NOT get invented numeric codes: their
   * identity travels as the canonical `code`, which is the string taxonomy the
   * rest of this API already publishes. A client reads ONE vocabulary.
   */
  it("carries the canonical envelope through as error.data", () => {
    const body = rpcErrorBody({
      error: new HandledError("scan_limit_exceeded", "Too much.", {
        httpStatus: 422,
      }),
      canonical: canonicalBody("scan_limit_exceeded", "Too much."),
      c: contextWith({ rpcId: 1 }),
    }) as { error: { data: { error: { code: string } } } };

    expect(body.error.data.error.code).toBe("scan_limit_exceeded");
  });

  /**
   * A 5xx redacts its message in the canonical body on purpose. Reading the
   * message off the raw error instead would leak the detail back out through
   * the RPC envelope — the same leak, one layer up.
   */
  it("takes the message from the canonical body, not the raw error", () => {
    const body = rpcErrorBody({
      error: new Error("Prisma: connection to db-7.internal refused"),
      canonical: canonicalBody("internal_error", "An unknown error occurred"),
      c: contextWith({}),
    }) as { error: { message: string } };

    expect(body.error.message).toBe("An unknown error occurred");
    expect(body.error.message).not.toContain("db-7.internal");
  });
});

describe("given an error is being given an HTTP status", () => {
  /**
   * The status a JSON-RPC purist would not send.
   *
   * This door answers with the real status rather than a blanket 200, because
   * CLIs, curl and proxies branch on it long before anything parses a body.
   * Pinned here so "answer 200 like the spec says" is a deliberate change to a
   * stated contract rather than a quiet one.
   */
  it("keeps an application refusal's own status", () => {
    const { status } = canonicalErrorFor(
      new HandledError("scan_limit_exceeded", "Too much.", { httpStatus: 422 }),
      {},
    );
    expect(status).toBe(422);
  });

  /**
   * `validation_error` is raised at 422 by the shared validator and remapped
   * to 400 by the canonical envelope, so one code does not carry two statuses
   * across the API. This family publishes canonical, so it gets the remap —
   * and an envelope refusal is therefore a 400, not the 422 the raising code
   * suggests.
   */
  it("remaps a validation failure to 400, the canonical status for it", () => {
    const { status } = canonicalErrorFor(
      new RequestValidationError({
        target: "json",
        violations: [{ field: "method", type: "invalid_enum_value", message: "no" }],
      }),
      {},
    );
    expect(status).toBe(400);
  });

  /** The guard branch: declared-but-unwired stays a 404 if it ever fires. */
  it("answers a method-table miss with 404", () => {
    const { status } = canonicalErrorFor(methodNotFound("query.nope"), {});
    expect(status).toBe(404);
  });
});

describe("given the id is read back off the request context", () => {
  it.each([
    ["a number", 1, 1],
    ["a string", "abc", "abc"],
    ["an explicit null", null, null],
  ])("recovers %s", (_label, stored, expected) => {
    expect(rpcIdOf(contextWith({ rpcId: stored }))).toBe(expected);
  });

  it("reports an absent id as undefined", () => {
    expect(rpcIdOf(contextWith({}))).toBeUndefined();
  });

  /** A body-shaped id is not a legal JSON-RPC id and must not be echoed. */
  it("refuses a non-scalar id rather than echoing it", () => {
    expect(rpcIdOf(contextWith({ rpcId: { nested: true } }))).toBeUndefined();
  });
});

/**
 * The id has to survive the validator, not just the handler.
 *
 * This is a regression suite for a real bug: the id was originally recorded
 * inside the route handler, which runs only AFTER the envelope validator has
 * passed. That records it exactly when it is least needed — a malformed
 * envelope, an unknown method or a batch never reaches the handler, so those
 * refusals answered with no `id` at all, and a client multiplexing calls over
 * one connection could not tell which of its outstanding requests had failed.
 *
 * Driven through a real middleware chain rather than a stubbed context,
 * because the bug was entirely one of ORDERING — a stub cannot express it, and
 * the assertion that missed it the first time was written against a stub.
 */
describe("given a request is refused before the handler runs", () => {
  /** The real chain shape: id-recorder, then validator, then handler. */
  function door() {
    const app = new Hono();
    app.onError((error, c) => {
      const { status, body } = canonicalErrorFor(error, {});
      return c.json(
        rpcErrorBody({ error, canonical: body as never, c }),
        status as never,
      );
    });
    app.post(
      "/",
      recordRpcId,
      zValidator("json", queryRpcRequestSchema),
      (c) => c.json(rpcResultBody({ id: c.req.valid("json").id, result: null })),
    );
    return app;
  }

  const send = async (body: unknown) => {
    const response = await door().request("/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: typeof body === "string" ? body : JSON.stringify(body),
    });
    return {
      status: response.status,
      body: (await response.json()) as Record<string, any>,
    };
  };

  it.each([
    [
      "an unknown method",
      { jsonrpc: "2.0", id: "call-7", method: "query.nope" },
    ],
    [
      "params of the wrong shape for the envelope",
      { jsonrpc: "2.0", id: "call-7", method: 42 },
    ],
    [
      "the wrong protocol version",
      { jsonrpc: "1.0", id: "call-7", method: "query.run" },
    ],
  ])("still echoes the id when refused for %s", async (_label, request) => {
    const { status, body } = await send(request);

    expect(status).toBe(400);
    expect(
      body.id,
      "the refusal dropped its id, so the client cannot match it to a call",
    ).toBe("call-7");
  });

  it("echoes a numeric id too, without coercing it to a string", async () => {
    const { body } = await send({ jsonrpc: "2.0", id: 7, method: "query.nope" });
    expect(body.id).toBe(7);
  });

  /**
   * A batch is refused, but it is still a JSON document with no top-level id —
   * so there is nothing to echo, and nothing must be invented.
   */
  it("omits the id for a batch, which has none to salvage", async () => {
    const { status, body } = await send([
      { jsonrpc: "2.0", id: 1, method: "query.schema" },
    ]);

    expect(status).toBe(400);
    expect(body).not.toHaveProperty("id");
  });

  it("survives a body that is not JSON at all, without masking the refusal", async () => {
    const { status, body } = await send("this is not json");

    expect(status).toBeGreaterThanOrEqual(400);
    expect(status).toBeLessThan(500);
    expect(body).not.toHaveProperty("id");
  });

  it("does not echo a non-scalar id, which is not a legal JSON-RPC id", async () => {
    const { body } = await send({
      jsonrpc: "2.0",
      id: { nested: true },
      method: "query.nope",
    });
    expect(body).not.toHaveProperty("id");
  });

  /** The success path must keep working through the added middleware. */
  it("still answers a well-formed call, id intact", async () => {
    const { status, body } = await send({
      jsonrpc: "2.0",
      id: "call-7",
      method: "query.schema",
    });

    expect(status).toBe(200);
    expect(body.id).toBe("call-7");
    expect(body.result).toBeNull();
  });
});

describe("given the envelope schema validates a request", () => {
  it("accepts a well-formed call", () => {
    const parsed = queryRpcRequestSchema.safeParse({
      jsonrpc: "2.0",
      id: 1,
      method: "query.run",
      params: { sql: "SELECT 1" },
    });
    expect(parsed.success).toBe(true);
  });

  /** `query.schema` takes no arguments, so absent params must be legal. */
  it("accepts a call with no params", () => {
    const parsed = queryRpcRequestSchema.safeParse({
      jsonrpc: "2.0",
      id: 1,
      method: "query.schema",
    });
    expect(parsed.success).toBe(true);
  });

  /**
   * Batching is not served. A top-level array must be refused by the envelope
   * rather than silently read as a single call — answering one element of a
   * batch is worse than refusing the batch.
   */
  it("refuses a batch", () => {
    const parsed = queryRpcRequestSchema.safeParse([
      { jsonrpc: "2.0", id: 1, method: "query.schema" },
    ]);
    expect(parsed.success).toBe(false);
  });

  it("refuses another protocol version", () => {
    const parsed = queryRpcRequestSchema.safeParse({
      jsonrpc: "1.0",
      id: 1,
      method: "query.run",
      params: {},
    });
    expect(parsed.success).toBe(false);
  });

  /**
   * An unknown method is rejected by the envelope, which is what makes the
   * handler's own not-found branch unreachable in practice — the reason that
   * branch is documented as a guard rather than a live code path.
   */
  it("refuses a method it does not serve", () => {
    const parsed = queryRpcRequestSchema.safeParse({
      jsonrpc: "2.0",
      id: 1,
      method: "query.drop",
    });
    expect(parsed.success).toBe(false);
  });
});
