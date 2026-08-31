/**
 * The query domain's two REST doors, exercised without a database.
 *
 * The integration suites drive the doors end to end and need ClickHouse,
 * Postgres and a seeded tenant. Everything asserted here is *surface* — that
 * the gate is installed, that a refusal answers in the canonical envelope, and
 * that the request schema admits exactly what the service can run — and none
 * of it depends on what LangWatchQL does, so it belongs in a test that runs
 * anywhere.
 *
 * The property under test throughout: **a caller must be refused before it
 * reaches a handler, and must be able to branch on why** — one envelope, one
 * vocabulary, the same one every other REST family publishes.
 *
 * @see ../[[...route]]/app.v1
 * @see https://github.com/langwatch/langwatch/issues/7565#issuecomment-5424087900
 */

import { describe, expect, it } from "vitest";

import { app as queryApp } from "../[[...route]]/app";
import { lwqlQuerySchema } from "../[[...route]]/schemas";

const RUN_PATH = "/api/v1/query";
const SCHEMA_PATH = "/api/v1/query/schema";

/**
 * The door is shut to an anonymous caller.
 *
 * A regression suite for a real hole: the routes were first declared with
 * `handlerManagedAuth`, which applies NO middleware — it is a declaration that
 * the HANDLER authenticates. The handlers never did. They read the project off
 * a context nothing had populated, so every anonymous call reached the service
 * and died on `project.id` of `undefined`: a 500 where a 401 belonged, and
 * `analytics:view` enforced nowhere.
 *
 * Driven through the real mounted app rather than a stub, because the hole was
 * that a declared policy installed nothing — and only the assembled app can
 * tell you what was actually installed. A stub would have reproduced the
 * mistake rather than caught it.
 *
 * These need no database: the refusal happens before any lookup.
 */
describe("given a caller presents no credential", () => {
  const send = async (path: string, init: RequestInit) => {
    const response = await queryApp.request(path, init);
    return {
      status: response.status,
      body: (await response.json()) as Record<string, any>,
    };
  };

  const runCall = () =>
    send(RUN_PATH, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sql: "SELECT 1" }),
    });

  const schemaCall = () => send(SCHEMA_PATH, { method: "GET" });

  describe("when either door is called", () => {
    it.each([
      ["POST /api/v1/query", runCall],
      ["GET /api/v1/query/schema", schemaCall],
    ])("refuses %s with 401 rather than reaching the handler", async (_label, call) => {
      const { status, body } = await call();

      expect(
        status,
        "a 500 here means the door opened and the handler crashed on an absent project",
      ).toBe(401);
      expect(body.error?.code).toBe("missing_credentials");
    });

    /**
     * The refusal must be the canonical envelope and nothing else. This family
     * briefly wrapped every error in a JSON-RPC envelope, which meant an auth
     * denial and a query refusal answered in two different shapes and an
     * integrator had to branch on status before it could read a `code` at all.
     * Plain REST removes that seam; this pins it removed.
     */
    it("answers the canonical envelope, at the top level", async () => {
      const { body } = await runCall();

      expect(
        body.jsonrpc,
        "a JSON-RPC envelope came back from a REST door",
      ).toBeUndefined();
      expect(body.error?.type).toBe("unauthenticated");
      expect(typeof body.error?.code).toBe("string");
    });
  });

  describe("when the body would not survive the validator", () => {
    /**
     * The refusal must not double as a directory. A body the schema would
     * refuse has to answer identically to one it would accept, or the
     * validator becomes an oracle an anonymous caller can probe the surface
     * with.
     */
    it("refuses it identically, before the validator runs", async () => {
      const wellFormed = await runCall();
      const malformed = await send(RUN_PATH, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sql: 42 }),
      });

      expect(malformed.status).toBe(wellFormed.status);
      expect(malformed.body.error?.code).toBe(wellFormed.body.error?.code);
    });
  });

  describe("when a path this family does not serve is called", () => {
    /** A path this family does not serve is a plain 404, not a 401 leak. */
    it("answers with 404", async () => {
      const response = await queryApp.request("/api/v1/query/nope", {
        method: "GET",
      });
      expect(response.status).toBe(404);
    });
  });
});

describe("given the request schema validates a query", () => {
  describe("when the body carries a statement the service can run", () => {
    it("accepts a well-formed statement", () => {
      expect(lwqlQuerySchema.safeParse({ sql: "SELECT 1" }).success).toBe(true);
    });

    it("accepts the optional period, step and bound parameters", () => {
      const parsed = lwqlQuerySchema.safeParse({
        sql: "SELECT 1",
        parameters: { floor: 10 },
        timeWindow: {
          start: "2026-02-20T00:00:00.000Z",
          end: "2026-02-21T00:00:00.000Z",
        },
        granularitySeconds: 3600,
      });
      expect(parsed.success, JSON.stringify(parsed.error?.issues)).toBe(true);
    });
  });

  describe("when the statement is absent or not a statement", () => {
    /** The body IS the query, so a missing statement is a schema failure. */
    it("refuses a body with no statement", () => {
      expect(lwqlQuerySchema.safeParse({}).success).toBe(false);
    });

    it("refuses an empty statement", () => {
      expect(lwqlQuerySchema.safeParse({ sql: "" }).success).toBe(false);
    });

    it("refuses a statement that is not a string", () => {
      expect(lwqlQuerySchema.safeParse({ sql: 42 }).success).toBe(false);
    });
  });

  describe("when an optional member is outside what the surface offers", () => {
    /**
     * A parameter is a *value*. Anything structured would be a value whose
     * shape the declared ClickHouse type cannot describe.
     */
    it("refuses a structured parameter value", () => {
      expect(
        lwqlQuerySchema.safeParse({
          sql: "SELECT 1",
          parameters: { floor: { nested: true } },
        }).success,
      ).toBe(false);
    });

    /**
     * The step is restricted to the ones the surface actually offers, so an
     * off-list value is a clean schema rejection rather than reaching the
     * service's backstop.
     */
    it("refuses a granularity step the surface does not offer", () => {
      expect(
        lwqlQuerySchema.safeParse({ sql: "SELECT 1", granularitySeconds: 7 })
          .success,
      ).toBe(false);
    });
  });
});
