/**
 * @vitest-environment node
 *
 * Integration tests for the enterprise plan gate on SCIM v2 provisioning routes.
 * Exercises the `requireEnterprise()` middleware in src/server/routes/scim.ts
 * by calling `app.request()` against the Hono app with `getApp()` stubbed to
 * control the plan provider and token verification.
 *
 * Spec: specs/auth/sso-phase1-enforcement.feature
 *   — SCIM Routes Enterprise Plan Check (scenarios 6–9)
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

// ── hoisted mocks — must be defined before vi.mock() calls ───────────────────
const {
  mockGetActivePlan,
  mockVerifyScimToken,
  mockListUsers,
  mockListGroups,
  mockScimLogRequest,
} = vi.hoisted(() => ({
  mockGetActivePlan: vi.fn(),
  mockVerifyScimToken: vi.fn(),
  mockListUsers: vi.fn(),
  mockListGroups: vi.fn(),
  mockScimLogRequest: vi.fn(),
}));

vi.mock("~/server/app-layer/app", () => ({
  getApp: () => ({
    planProvider: { getActivePlan: mockGetActivePlan },
    scimTokens: { verify: mockVerifyScimToken },
    scim: {
      listUsers: mockListUsers,
      createUser: vi.fn(),
    },
    scimGroups: {
      listGroups: mockListGroups,
      createGroup: vi.fn(),
    },
    ssoConnection: {
      logScimRequest: mockScimLogRequest,
    },
  }),
}));

vi.mock("~/utils/logger/server", () => ({
  createLogger: () => ({
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
    child: vi.fn().mockReturnThis(),
  }),
}));

vi.mock("~/app/api/middleware/logger", () => ({
  loggerMiddleware: () => async (_c: unknown, next: () => Promise<void>) => next(),
}));

vi.mock("~/app/api/middleware/tracer", () => ({
  tracerMiddleware: () => async (_c: unknown, next: () => Promise<void>) => next(),
}));

import { app } from "../scim";

const ENTERPRISE_BEARER = "Bearer valid-enterprise-token";
const FREE_BEARER = "Bearer valid-free-token";

beforeEach(() => {
  vi.clearAllMocks();
  mockScimLogRequest.mockResolvedValue(undefined);
  mockListUsers.mockResolvedValue({ totalResults: 0, Resources: [] });
  mockListGroups.mockResolvedValue({ totalResults: 0, Resources: [] });

  // Both tokens resolve to org-1
  mockVerifyScimToken.mockImplementation(({ token }: { token: string }) => {
    if (token === "valid-enterprise-token" || token === "valid-free-token") {
      return Promise.resolve({ organizationId: "org-1" });
    }
    return Promise.resolve(null);
  });

  // Default plan is ENTERPRISE
  mockGetActivePlan.mockResolvedValue({ type: "ENTERPRISE" });
});

describe("SCIM v2 enterprise plan gate", () => {
  describe("when the bearer token belongs to a non-enterprise org", () => {
    beforeEach(() => {
      mockGetActivePlan.mockResolvedValue({ type: "FREE" });
    });

    /** @scenario SCIM User endpoint rejects requests from non-enterprise org */
    it("rejects GET /api/scim/v2/Users with 403 and a SCIM error body", async () => {
      const res = await app.request("/api/scim/v2/Users", {
        method: "GET",
        headers: { Authorization: FREE_BEARER },
      });

      expect(res.status).toBe(403);
      const body = (await res.json()) as { detail: string; schemas: string[] };
      expect(body.schemas).toContain(
        "urn:ietf:params:scim:api:messages:2.0:Error",
      );
      expect(body.detail).toMatch(/enterprise/i);
    });

    /** @scenario SCIM Group endpoint rejects requests from non-enterprise org */
    it("rejects POST /api/scim/v2/Groups with 403 and a SCIM error body", async () => {
      const res = await app.request("/api/scim/v2/Groups", {
        method: "POST",
        headers: {
          Authorization: FREE_BEARER,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          schemas: ["urn:ietf:params:scim:schemas:core:2.0:Group"],
          displayName: "Engineering",
        }),
      });

      expect(res.status).toBe(403);
      const body = (await res.json()) as { detail: string };
      expect(body.detail).toMatch(/enterprise/i);
    });
  });

  describe("when the bearer token belongs to an enterprise org", () => {
    beforeEach(() => {
      mockGetActivePlan.mockResolvedValue({ type: "ENTERPRISE" });
    });

    /** @scenario SCIM endpoints accept requests from enterprise org */
    it("allows GET /api/scim/v2/Users to proceed to the handler (no 403)", async () => {
      const res = await app.request("/api/scim/v2/Users", {
        method: "GET",
        headers: { Authorization: ENTERPRISE_BEARER },
      });

      // The handler was reached — any non-403 status means the gate passed
      expect(res.status).not.toBe(403);
      expect(res.status).not.toBe(401);
    });
  });

  describe("SCIM discovery endpoints", () => {
    /** @scenario SCIM discovery endpoints are accessible without enterprise check */
    it("returns 200 for GET /api/scim/v2/ServiceProviderConfig with no auth required", async () => {
      const res = await app.request("/api/scim/v2/ServiceProviderConfig", {
        method: "GET",
      });

      expect(res.status).toBe(200);
      const body = (await res.json()) as { schemas: string[] };
      expect(body.schemas).toContain(
        "urn:ietf:params:scim:schemas:core:2.0:ServiceProviderConfig",
      );
    });
  });
});
