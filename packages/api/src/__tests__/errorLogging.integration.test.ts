import { NotFoundError } from "@langwatch/handled-error";
import { Hono } from "hono";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { z } from "zod";

const logRecords: { level: string; payload: Record<string, unknown>; message: string }[] =
  [];

/**
 * Capture every record the request logger writes, at the logger seam rather
 * than the `logHttpRequest` seam — the point of these tests is how many
 * records a failed request produces, so the thing that writes them has to be
 * real.
 */
vi.mock("@langwatch/observability", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@langwatch/observability")>();
  const record =
    (level: string) => (payload: Record<string, unknown>, message: string) => {
      logRecords.push({ level, payload, message });
    };
  return {
    ...actual,
    createLogger: () => ({
      info: record("info"),
      warn: record("warn"),
      error: record("error"),
      debug: record("debug"),
    }),
  };
});

const { createErrorHandler } = await import("../errors.js");
const { loggerMiddleware } = await import("../middleware.js");

function appThatThrows(err: unknown) {
  const app = new Hono();
  app.use("*", loggerMiddleware({ name: "test" }));
  app.onError(createErrorHandler());
  app.get("/things", () => {
    throw err;
  });
  return app;
}

function errorRecords() {
  return logRecords.filter((r) => r.message === "error handling request");
}

describe("given a request that fails", () => {
  beforeEach(() => {
    logRecords.length = 0;
  });

  describe("when the handler throws an unhandled error", () => {
    it("writes exactly one error record", async () => {
      const app = appThatThrows(new Error("boom"));

      const res = await app.request("/things");

      expect(res.status).toBe(500);
      expect(errorRecords()).toHaveLength(1);
      expect(errorRecords()[0]!.level).toBe("error");
    });
  });

  describe("when the handler throws a customer-fault HandledError", () => {
    it("writes exactly one record, at warn, with the handled-error metadata", async () => {
      const app = appThatThrows(new NotFoundError("not_found", "Resource", "abc"));

      const res = await app.request("/things");

      expect(res.status).toBe(404);
      const records = logRecords.filter(
        (r) => r.message === "error handling request",
      );
      expect(records).toHaveLength(1);
      expect(records[0]!.level).toBe("warn");
      expect(records[0]!.payload).toMatchObject({
        statusCode: 404,
        handledErrorCode: "not_found",
        handledErrorFault: "customer",
      });
    });
  });

  describe("when the handler throws a ZodError", () => {
    it("writes one record against the 422 the caller received, not a derived 500", async () => {
      let zodError: unknown;
      try {
        z.object({ name: z.string() }).parse({});
      } catch (err) {
        zodError = err;
      }
      const app = appThatThrows(zodError);

      const res = await app.request("/things");

      expect(res.status).toBe(422);
      expect(errorRecords()).toHaveLength(1);
      expect(errorRecords()[0]!.level).toBe("warn");
      expect(errorRecords()[0]!.payload).toMatchObject({
        statusCode: 422,
        handledErrorCode: "validation_error",
      });
    });
  });
});

describe("given a request that succeeds", () => {
  beforeEach(() => {
    logRecords.length = 0;
  });

  describe("when the handler returns normally", () => {
    it("writes no error record", async () => {
      const app = new Hono();
      app.use("*", loggerMiddleware({ name: "test" }));
      app.onError(createErrorHandler());
      app.get("/things", (c) => c.json({ ok: true }));

      const res = await app.request("/things");

      expect(res.status).toBe(200);
      expect(errorRecords()).toHaveLength(0);
      expect(logRecords.filter((r) => r.message === "request handled")).toHaveLength(
        1,
      );
    });
  });
});
