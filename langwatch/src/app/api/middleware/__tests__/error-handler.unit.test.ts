import { HandledError } from "@langwatch/handled-error";
import { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LimitExceededError } from "~/server/license-enforcement/errors";
import { ModelNotConfiguredError } from "~/server/modelProviders/modelNotConfiguredError";
import { InternalServerError } from "../../shared/errors";
import { handleError } from "../error-handler";

vi.mock("~/server/app-layer/app", () => ({
  getApp: vi.fn(),
}));

vi.mock("~/env.mjs", () => ({
  env: {
    IS_SAAS: false,
    BASE_HOST: "https://my-instance.example.com",
  },
}));

vi.mock("@langwatch/observability", () => ({
  createLogger: () => ({
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  }),
}));

describe("handleError()", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  function createTestApp(errorToThrow: Error) {
    const app = new Hono();
    app.onError(handleError);
    app.get("/", () => {
      throw errorToThrow;
    });
    return app;
  }

  // Mirrors what the tracer middleware does: stash the request's trace/span ids
  // on the context before the handler runs, so handleError can read them.
  function createTracedTestApp(
    errorToThrow: Error,
    ids: { traceId?: string; spanId?: string },
  ) {
    const app = new Hono<{ Variables: { traceId: string; spanId: string } }>();
    app.onError(handleError);
    app.use("*", async (c, next) => {
      if (ids.traceId) c.set("traceId", ids.traceId);
      if (ids.spanId) c.set("spanId", ids.spanId);
      await next();
    });
    app.get("/", () => {
      throw errorToThrow;
    });
    return app;
  }

  describe("when error is a LimitExceededError", () => {
    it("returns 403 with HandledError shape", async () => {
      const error = new LimitExceededError("prompts", 5, 5);
      const app = createTestApp(error);

      const res = await app.request("/");

      expect(res.status).toBe(403);
      const body = await res.json();
      expect(body.error).toBe("resource_limit_exceeded");
      expect(body.message).toBe(
        "You have reached the maximum number of prompts",
      );
    });

    it("includes meta fields in the response body", async () => {
      const error = new LimitExceededError("prompts", 5, 5);
      const app = createTestApp(error);

      const res = await app.request("/");

      const body = await res.json();
      expect(body).toHaveProperty("limitType", "prompts");
      expect(body).toHaveProperty("current", 5);
      expect(body).toHaveProperty("max", 5);
    });
  });

  describe("when error carries remediation fields", () => {
    it("emits tips, docsUrl and fault in the body", async () => {
      const error = new (class extends HandledError {
        constructor() {
          super("query_memory_exceeded", "Query exceeded its memory limit", {
            httpStatus: 422,
            fault: "customer",
            tips: ["Narrow the time range"],
            docsUrl: "https://docs.langwatch.ai/traces",
          });
        }
      })();
      const app = createTestApp(error);

      const res = await app.request("/");

      expect(res.status).toBe(422);
      const body = await res.json();
      expect(body.error).toBe("query_memory_exceeded");
      expect(body.tips).toEqual(["Narrow the time range"]);
      expect(body.docsUrl).toBe("https://docs.langwatch.ai/traces");
      expect(body.fault).toBe("customer");
    });

    it("omits remediation keys when the error has none", async () => {
      const error = new (class extends HandledError {
        constructor() {
          super("plain_handled", "nothing to add", { httpStatus: 400 });
        }
      })();
      const app = createTestApp(error);

      const res = await app.request("/");

      const body = await res.json();
      expect(body).not.toHaveProperty("tips");
      expect(body).not.toHaveProperty("docsUrl");
      expect(body.fault).toBe("customer");
    });
  });

  describe("when error is a ModelNotConfiguredError", () => {
    it("returns 400 with the missing-model cause instead of a generic 500", async () => {
      const error = new ModelNotConfiguredError(
        "evaluator.create_default",
        "DEFAULT",
        "Evaluator default model",
        "project_123",
      );
      const app = createTestApp(error);

      const res = await app.request("/");

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.cause).toBe("MODEL_NOT_CONFIGURED");
      expect(body.featureKey).toBe("evaluator.create_default");
      expect(body.role).toBe("DEFAULT");
      expect(body.featureDisplayName).toBe("Evaluator default model");
      expect(body.projectId).toBe("project_123");
      expect(body.message).toContain("No model configured");
    });
  });

  describe("when error is a Prisma P2002 unique-constraint violation", () => {
    it("returns 409 conflict with the constrained field in the message", async () => {
      const error = Object.assign(
        new Error("Unique constraint failed on the fields: (`handle`)"),
        {
          code: "P2002",
          meta: { target: ["handle"] },
        },
      );
      const app = createTestApp(error);

      const res = await app.request("/");

      expect(res.status).toBe(409);
      const body = await res.json();
      expect(body.error).toBe("Conflict");
      expect(body.message).toContain("handle");
    });
  });

  describe("when error is a non-P2002 PrismaClientKnownRequestError", () => {
    it("does NOT get mislabeled as 409 conflict", async () => {
      // P2003 (foreign key violation) and similar should bubble as real
      // 500s — labeling them 409 would hide genuine backend breakage.
      const error = Object.assign(
        new Error("Foreign key constraint failed on the field: projectId"),
        {
          name: "PrismaClientKnownRequestError",
          code: "P2003",
        },
      );
      const app = createTestApp(error);

      const res = await app.request("/");

      expect(res.status).toBe(500);
      const body = await res.json();
      expect(body.error).toBe("Internal server error");
    });
  });

  describe("when error has no recognizable shape (fallback 500)", () => {
    it("does not expose the underlying error message", async () => {
      const error = Object.assign(new Error("database connection refused"), {
        name: "DatabaseError",
        code: "ECONNREFUSED",
      });
      const app = createTestApp(error);

      const res = await app.request("/");

      expect(res.status).toBe(500);
      const body = await res.json();
      expect(body.error).toBe("Internal server error");
      expect(body.message).toBe("An unknown error occurred");
      expect(JSON.stringify(body)).not.toContain("database connection refused");
      expect(JSON.stringify(body)).not.toContain("ECONNREFUSED");
    });

    it("does not expose a message merely because it contains 'not found'", async () => {
      const app = createTestApp(
        new Error("relation internal_projection was not found on db.internal"),
      );

      const res = await app.request("/");
      const body = await res.json();

      expect(res.status).toBe(500);
      expect(body.message).toBe("An unknown error occurred");
      expect(JSON.stringify(body)).not.toContain("internal_projection");
    });

    it("sanitizes explicit 500 HttpErrors too", async () => {
      const app = createTestApp(
        new InternalServerError("Prisma connection pool exhausted"),
      );

      const res = await app.request("/");
      const body = await res.json();

      expect(res.status).toBe(500);
      expect(body.message).toBe("An unknown error occurred");
      expect(JSON.stringify(body)).not.toContain("Prisma");
    });

    it("uses the same sanitized message in production", async () => {
      const originalEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = "production";
      try {
        const error = Object.assign(
          new Error("connect ECONNREFUSED 10.0.0.42:5432"),
          {
            name: "PrismaClientInitializationError",
            code: "P1001",
          },
        );
        const app = createTestApp(error);

        const res = await app.request("/");

        expect(res.status).toBe(500);
        const body = await res.json();
        expect(body.error).toBe("Internal server error");
        expect(body.message).toBe("An unknown error occurred");
        expect(JSON.stringify(body)).not.toContain("10.0.0.42:5432");
        expect(JSON.stringify(body)).not.toContain("P1001");
        expect(JSON.stringify(body)).not.toContain(
          "PrismaClientInitializationError",
        );
      } finally {
        process.env.NODE_ENV = originalEnv;
      }
    });
  });

  describe("given trace info on error responses", () => {
    const originalEnv = process.env.NODE_ENV;
    const originalGrafana = process.env.GRAFANA_BASE_URL;

    afterEach(() => {
      process.env.NODE_ENV = originalEnv;
      if (originalGrafana === undefined) delete process.env.GRAFANA_BASE_URL;
      else process.env.GRAFANA_BASE_URL = originalGrafana;
    });

    describe("when a Grafana is configured", () => {
      beforeEach(() => {
        process.env.GRAFANA_BASE_URL = "http://127.0.0.1:3000";
      });

      it("attaches the trace/span ids and clickable Grafana links", async () => {
        const app = createTracedTestApp(new Error("boom"), {
          traceId: "a".repeat(32),
          spanId: "b".repeat(16),
        });

        const res = await app.request("/");
        const body = await res.json();

        expect(body.trace.traceId).toBe("a".repeat(32));
        expect(body.trace.spanId).toBe("b".repeat(16));
        expect(body.trace.traceUrl).toContain("/explore");
        expect(body.trace.traceUrl).toContain("http://127.0.0.1:3000");
        expect(body.trace.logsUrl).toContain("/explore");
      });

      it("omits the all-zero (no active span) trace id", async () => {
        const app = createTracedTestApp(new Error("boom"), {
          traceId: "0".repeat(32),
          spanId: "0".repeat(16),
        });

        const res = await app.request("/");
        const body = await res.json();

        expect(body).not.toHaveProperty("trace");
      });

      it("still attaches the block in production (Grafana is access-controlled)", async () => {
        process.env.NODE_ENV = "production";
        const app = createTracedTestApp(new Error("boom"), {
          traceId: "a".repeat(32),
          spanId: "b".repeat(16),
        });

        const res = await app.request("/");
        const body = await res.json();

        expect(body.trace.traceId).toBe("a".repeat(32));
        expect(body.trace.traceUrl).toContain("/explore");
      });
    });

    describe("when no Grafana is configured", () => {
      beforeEach(() => {
        delete process.env.GRAFANA_BASE_URL;
      });

      it("still surfaces the ids, without links", async () => {
        const app = createTracedTestApp(new Error("boom"), {
          traceId: "a".repeat(32),
          spanId: "b".repeat(16),
        });

        const res = await app.request("/");
        const body = await res.json();

        expect(body.trace.traceId).toBe("a".repeat(32));
        expect(body.trace).not.toHaveProperty("traceUrl");
      });
    });
  });
});
