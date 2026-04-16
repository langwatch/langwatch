import { describe, expect, it, vi, beforeEach } from "vitest";
import { Hono } from "hono";
import { handleError } from "../error-handler";
import { LimitExceededError } from "~/server/license-enforcement/errors";

vi.mock("~/server/app-layer/app", () => ({
  getApp: vi.fn(),
}));

vi.mock("~/env.mjs", () => ({
  env: {
    IS_SAAS: false,
    BASE_HOST: "https://my-instance.example.com",
  },
}));

vi.mock("~/utils/logger/server", () => ({
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

  describe("when error is a LimitExceededError", () => {
    it("returns 403 with DomainError shape", async () => {
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
    it("includes the underlying error message in non-production environments", async () => {
      const error = Object.assign(new Error("database connection refused"), {
        name: "DatabaseError",
        code: "ECONNREFUSED",
      });
      const app = createTestApp(error);

      const res = await app.request("/");

      expect(res.status).toBe(500);
      const body = await res.json();
      // Kind stays generic so clients can categorize, but message gains
      // the actual cause so humans and assistants can act on it.
      expect(body.error).toBe("Internal server error");
      expect(body.message).toContain("database connection refused");
      expect(body.message).toContain("ECONNREFUSED");
    });

    it("hides exception internals in production", async () => {
      // Leaking raw error.message in production could expose schema
      // names, file paths, or credentials. Keep the public shape generic.
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
        expect(body.message).toBe("Internal server error");
        expect(body.message).not.toContain("10.0.0.42");
        expect(body.message).not.toContain("P1001");
      } finally {
        process.env.NODE_ENV = originalEnv;
      }
    });
  });
});
