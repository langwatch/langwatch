// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * GET /api/auth/cli/budget/status — the pre-flight budget probe the CLI
 * calls before exec'ing a wrapped tool.
 *
 * Spec: specs/ai-gateway/governance/budget-exceeded.feature
 *       docs/ai-gateway/governance/cli-reference.mdx
 *         "Budget pre-check (graceful degradation)"
 */
import { createAppRestSecurity } from "@langwatch/api/rest";
import type { ErrorHandler, MiddlewareHandler } from "hono";
import { describe, expect, it, vi } from "vitest";

import { createGovernanceCliRestApp, type GovernanceCliRestPorts } from "../governance-cli.api";

describe("GET /api/auth/cli/budget/status", () => {
  describe("when the Bearer token is unknown to the access-token store", () => {
    /** @scenario After deactivation, /budget/status returns 401 for the revoked access_token */
    it("returns 401 — unknown / expired / revoked tokens are rejected", async () => {
      const api = mountCli({ resolve: vi.fn().mockResolvedValue(null) });

      const response = await api.fetch("/api/auth/cli/budget/status", {
        Authorization: "Bearer lw_at_revoked-token",
      });

      expect(response.status).toBe(401);
    });
  });
});

function mountCli(accessTokens: { resolve: GovernanceCliRestPorts["accessTokens"]["resolve"] }) {
  const ports: GovernanceCliRestPorts = {
    accessTokens: {
      resolve: accessTokens.resolve,
      revoke: vi.fn().mockResolvedValue(undefined),
    } as never,
    governance: () => ({}) as never,
    database: () => ({}) as never,
    ensurePersonalWorkspace: vi.fn(),
    tryFindPersonalWorkspace: vi.fn().mockResolvedValue(null),
    plans: () => ({}) as never,
    permittedOnOrganization: vi.fn().mockResolvedValue(true),
    permittedOnProject: vi.fn().mockResolvedValue(true),
  } as unknown as GovernanceCliRestPorts;

  const app = createGovernanceCliRestApp({
    security: passThroughSecurity(),
    ports,
  });

  return {
    fetch: (path: string, headers: Record<string, string> = {}) =>
      app.fetch(new Request(`http://api.test${path}`, { headers })),
  };
}

const renderHandled: ErrorHandler = (error, c) => {
  return c.json({ error: String(error) }, 500);
};

function passThroughSecurity() {
  const noop: MiddlewareHandler = async (_c, next) => {
    await next();
  };
  return createAppRestSecurity({
    appContext: noop,
    requestLogger: () => noop,
    requestTracer: () => noop,
    legacyErrorHandler: renderHandled,
    canonicalErrorHandler: renderHandled,
    authenticateProject: () => noop,
    authorizeProjectPermission: () => noop,
    authorizeApiKeyCeiling: () => noop,
    authenticateOrganization: () => noop,
    authorizeOrganizationPermission: () => noop,
    authorizeRouteProjectPermission: () => noop,
    authenticateOrganizationThrowing: noop,
    authorizeOrganizationPermissionThrowing: () => noop,
  } as never);
}
