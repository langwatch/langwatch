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
import { Hono } from "hono";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "~/generated/prisma/client";
import { appContextMiddlewareFor } from "~/app/api/middleware/app-context";
import type { App } from "~/server/app-layer/app";

// auth-middleware → api/rbac → ~/server/auth → ~/server/better-auth → redis +
// db. Mock both so no real connection keeps the worker alive (established
// pattern; see auth-middleware.unit.test.ts).
vi.mock("~/server/db", () => ({ prisma: {} }));

const resolveOrgOnly = vi.fn();
const markUsed = vi.fn();

import { createOrgAuthMiddleware } from "../auth-middleware";

const ORGANIZATION = { id: "org_1", name: "Acme" };

function buildPrisma(organization: object | null): PrismaClient {
  return {
    organization: { findUnique: vi.fn().mockResolvedValue(organization) },
  } as unknown as PrismaClient;
}

/** A client whose organization lookup is down, not one that finds nothing. */
function buildUnreachablePrisma(error: Error): PrismaClient {
  return {
    organization: { findUnique: vi.fn().mockRejectedValue(error) },
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
function buildApp(options: { prisma: PrismaClient; refusals?: "respond" | "throw" }) {
  const caught: unknown[] = [];
  const app = new Hono<TestEnv>();
  app.onError((error, c) => {
    caught.push(error);
    return c.json({ caught: true }, 500);
  });
  app.use(
    appContextMiddlewareFor({
      apiKeys: {
        resolveOrganizationToken: resolveOrgOnly,
        markUsed,
      },
      projects: {},
    } as App),
  );
  app.use(
    createOrgAuthMiddleware({
      prisma: options.prisma,
      ...(options.refusals ? { refusals: options.refusals } : {}),
    }),
  );
  app.get("/probe", (c) => c.json({ organizationId: c.get("organization").id }));
  return { app, caught };
}

const RESOLVED_TOKEN = {
  ok: true,
  resolved: {
    type: "apiKey",
    apiKeyId: "key_1",
    userId: "user_1",
    organizationId: ORGANIZATION.id,
  },
};

/** A token that resolves to no organization: unknown, revoked, or malformed. */
const UNUSABLE_CREDENTIAL = { ok: false, reason: "unusable_credential" };

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
        message: "Authentication required. Use Authorization: Bearer <api-key>.",
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
      resolveOrgOnly.mockResolvedValue(UNUSABLE_CREDENTIAL);
    });

    it("responds 401 with the legacy body in the default mode", async () => {
      const { app } = buildApp({ prisma: buildPrisma(ORGANIZATION) });

      const res = await app.request("/probe", {
        headers: { Authorization: "Bearer sk-lw-unknown" },
      });

      expect(res.status).toBe(401);
      // Deliberately vague: naming the credential class here would say
      // "Project API keys cannot be used here" at a typo and at a revoked key
      // too, and would confirm to an unauthenticated caller which secrets
      // exist. The wrong-class refusal below is the one that names them.
      expect(await res.json()).toEqual({
        error: "Unauthorized",
        message: "Invalid credentials.",
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

  describe("given a working key of the wrong credential class", () => {
    beforeEach(() => {
      resolveOrgOnly.mockResolvedValue({
        ok: false,
        reason: "wrong_credential_class",
      });
    });

    it("throws credential_class_mismatch carrying the two classes in throw mode", async () => {
      const { app, caught } = buildApp({
        prisma: buildPrisma(ORGANIZATION),
        refusals: "throw",
      });

      await app.request("/probe", {
        headers: { Authorization: "Bearer sk-lw-project-key" },
      });

      expect(caught).toHaveLength(1);
      const error = caught[0] as HandledError;
      expect(error.code).toBe("credential_class_mismatch");
      expect(error.httpStatus).toBe(401);
      // The context is what makes the refusal actionable, and dropping it in
      // one mode leaves the two modes describing the same refusal differently.
      expect(error.meta).toEqual({
        required: "organization_api_key",
        presented: "project_api_key",
      });
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

  describe("given the organization lookup fails on the database", () => {
    const infraFailure = new Error("connection reset by peer");

    beforeEach(() => {
      resolveOrgOnly.mockResolvedValue(RESOLVED_TOKEN);
    });

    /** @scenario A database failure loading the organization answers the family's server error */
    it("responds 500 with the legacy body in the default mode", async () => {
      const { app, caught } = buildApp({
        prisma: buildUnreachablePrisma(infraFailure),
      });

      const res = await app.request("/probe", {
        headers: { Authorization: "Bearer sk-lw-valid" },
      });

      expect(res.status).toBe(500);
      expect(await res.json()).toEqual({
        error: "Internal Server Error",
        message: "Authentication service error",
      });
      expect(caught).toEqual([]);
    });

    /** @scenario A database failure loading the organization is re-raised unchanged */
    it("rethrows the original error plain in throw mode, never a handled one", async () => {
      const { app, caught } = buildApp({
        prisma: buildUnreachablePrisma(infraFailure),
        refusals: "throw",
      });

      await app.request("/probe", {
        headers: { Authorization: "Bearer sk-lw-valid" },
      });

      expect(caught).toHaveLength(1);
      expect(caught[0]).toBe(infraFailure);
      expect(HandledError.isHandled(caught[0])).toBe(false);
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
