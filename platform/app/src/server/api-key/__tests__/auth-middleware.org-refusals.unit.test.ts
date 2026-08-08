/**
 * @vitest-environment node
 *
 * The two refusal modes of `createOrgAuthMiddleware`.
 *
 * The default, `respond`, answers refusals itself in the family's envelope,
 * pinned here byte-for-byte because every existing consumer parses those
 * bodies. The `throw` mode raises the SAME refusals as handled errors so a
 * family whose error handler owns the response shape serialises them like its
 * domain errors; an infrastructure failure during auth stays a plain error
 * there (ADR-045: infra is never dressed up as handled).
 */
import { HandledError } from "@langwatch/handled-error";
import type { PrismaClient } from "@prisma/client";
import { Hono } from "hono";
import { beforeEach, describe, expect, it, vi } from "vitest";

// auth-middleware → api/rbac → ~/server/auth → ~/server/better-auth → redis +
// db. Mock both so no real connection keeps the worker alive (established
// pattern; see auth-middleware.unit.test.ts).
vi.mock("~/server/db", () => ({ prisma: {} }));
vi.mock("~/server/redis", () => ({ connection: undefined }));

const resolveOrgOnly = vi.fn();
const markUsed = vi.fn();

vi.mock("../token-resolver", () => ({
  TokenResolver: {
    create: () => ({ resolveOrgOnly, markUsed }),
  },
}));

import { createOrgAuthMiddleware } from "../auth-middleware";

const ORGANIZATION = { id: "org_1", name: "Acme" };

function buildPrisma(organization: object | null): PrismaClient {
  return {
    organization: { findUnique: vi.fn().mockResolvedValue(organization) },
  } as unknown as PrismaClient;
}

type TestEnv = {
  Variables: {
    organization: { id: string };
  };
};

/**
 * Mounts the middleware in a real Hono app so refusals travel the same path
 * they do in production. Thrown errors are captured by onError so each test
 * can assert on the error itself rather than on a re-rendered body.
 */
function buildApp(options: {
  prisma: PrismaClient;
  refusals?: "respond" | "throw";
}) {
  const caught: unknown[] = [];
  const app = new Hono<TestEnv>();
  app.onError((error, c) => {
    caught.push(error);
    return c.json({ caught: true }, 500);
  });
  app.use(
    createOrgAuthMiddleware({
      prisma: options.prisma,
      ...(options.refusals ? { refusals: options.refusals } : {}),
    }),
  );
  app.get("/probe", (c) =>
    c.json({ organizationId: c.get("organization").id }),
  );
  return { app, caught };
}

const RESOLVED_TOKEN = {
  type: "apiKey",
  apiKeyId: "key_1",
  userId: "user_1",
  organizationId: ORGANIZATION.id,
};

beforeEach(() => {
  resolveOrgOnly.mockReset();
  markUsed.mockReset();
});

describe("createOrgAuthMiddleware", () => {
  describe("given a request with no credentials", () => {
    it("responds 401 with the legacy body in the default mode", async () => {
      const { app, caught } = buildApp({ prisma: buildPrisma(ORGANIZATION) });

      const res = await app.request("/probe");

      expect(res.status).toBe(401);
      expect(await res.json()).toEqual({
        error: "Unauthorized",
        message:
          "Authentication required. Use Authorization: Bearer <api-key>.",
      });
      expect(caught).toEqual([]);
    });

    it("throws missing_credentials in throw mode", async () => {
      const { app, caught } = buildApp({
        prisma: buildPrisma(ORGANIZATION),
        refusals: "throw",
      });

      await app.request("/probe");

      expect(caught).toHaveLength(1);
      const error = caught[0];
      expect(HandledError.isHandled(error)).toBe(true);
      expect((error as HandledError).code).toBe("missing_credentials");
      expect((error as HandledError).httpStatus).toBe(401);
    });
  });

  describe("given a token the resolver does not recognise", () => {
    beforeEach(() => {
      resolveOrgOnly.mockResolvedValue(null);
    });

    it("responds 401 with the legacy body in the default mode", async () => {
      const { app } = buildApp({ prisma: buildPrisma(ORGANIZATION) });

      const res = await app.request("/probe", {
        headers: { Authorization: "Bearer sk-lw-unknown" },
      });

      expect(res.status).toBe(401);
      expect(await res.json()).toEqual({
        error: "Unauthorized",
        message:
          "Invalid credentials. Organization-level endpoints require an admin API key created in Settings > API Keys. Project API keys cannot be used here.",
      });
    });

    it("throws invalid_credentials in throw mode", async () => {
      const { app, caught } = buildApp({
        prisma: buildPrisma(ORGANIZATION),
        refusals: "throw",
      });

      await app.request("/probe", {
        headers: { Authorization: "Bearer sk-lw-unknown" },
      });

      expect(caught).toHaveLength(1);
      expect((caught[0] as HandledError).code).toBe("invalid_credentials");
      expect((caught[0] as HandledError).httpStatus).toBe(401);
    });
  });

  describe("given a valid token whose organization no longer exists", () => {
    beforeEach(() => {
      resolveOrgOnly.mockResolvedValue(RESOLVED_TOKEN);
    });

    it("throws organization_not_found in throw mode", async () => {
      const { app, caught } = buildApp({
        prisma: buildPrisma(null),
        refusals: "throw",
      });

      await app.request("/probe", {
        headers: { Authorization: "Bearer sk-lw-orphaned" },
      });

      expect(caught).toHaveLength(1);
      expect((caught[0] as HandledError).code).toBe("organization_not_found");
      expect((caught[0] as HandledError).httpStatus).toBe(401);
    });
  });

  describe("given a database failure during authentication", () => {
    const infraFailure = new Error("connection refused");

    beforeEach(() => {
      resolveOrgOnly.mockRejectedValue(infraFailure);
    });

    it("responds 500 with the legacy body in the default mode", async () => {
      const { app, caught } = buildApp({ prisma: buildPrisma(ORGANIZATION) });

      const res = await app.request("/probe", {
        headers: { Authorization: "Bearer sk-lw-any" },
      });

      expect(res.status).toBe(500);
      expect(await res.json()).toEqual({
        error: "Internal Server Error",
        message: "Authentication service error",
      });
      expect(caught).toEqual([]);
    });

    it("rethrows the original error plain in throw mode, never a handled one", async () => {
      const { app, caught } = buildApp({
        prisma: buildPrisma(ORGANIZATION),
        refusals: "throw",
      });

      await app.request("/probe", {
        headers: { Authorization: "Bearer sk-lw-any" },
      });

      expect(caught).toHaveLength(1);
      expect(caught[0]).toBe(infraFailure);
      expect(HandledError.isHandled(caught[0])).toBe(false);
    });
  });

  describe("given a valid credential", () => {
    beforeEach(() => {
      resolveOrgOnly.mockResolvedValue(RESOLVED_TOKEN);
    });

    it("sets the organization on context in both modes", async () => {
      for (const refusals of ["respond", "throw"] as const) {
        const { app, caught } = buildApp({
          prisma: buildPrisma(ORGANIZATION),
          refusals,
        });

        const res = await app.request("/probe", {
          headers: { Authorization: "Bearer sk-lw-valid" },
        });

        expect(res.status).toBe(200);
        expect(await res.json()).toEqual({ organizationId: ORGANIZATION.id });
        expect(caught).toEqual([]);
      }
    });
  });
});
