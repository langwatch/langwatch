/**
 * Finding H12 of the 2026-09-04 feature-surface security pass: the gateway
 * platform family is a PROJECT app, so its declared permission resolves at the
 * caller's own project — while every by-id budget and cache-rule handler
 * widens to the organization before it writes. The write is authorized where
 * it acts.
 *
 * Spec: specs/security/resource-scope-permission-checks.feature
 */
import { createAppRestSecurity, type AppRestSecurity } from "@langwatch/api/rest";
import { PermissionDeniedError } from "@langwatch/authz-contract";
import type { ErrorHandler, MiddlewareHandler } from "hono";
import { describe, expect, it, vi } from "vitest";

import type { GatewayApp } from "#app/gateway.app";
import { createGatewayPlatformRestApp } from "../gateway-platform.api";

const PROJECT_ID = "project_caller";
const ORGANIZATION_ID = "organization_1";

const renderUnexpected: ErrorHandler = (error, c) =>
  c.json({ error: { type: "internal_error", code: "internal_error", message: String(error) } }, 500);

function testSecurity(): AppRestSecurity {
  const pass: MiddlewareHandler = async (_c, next) => next();
  const asProject: MiddlewareHandler = async (c, next) => {
    c.set("project", { id: PROJECT_ID, slug: "caller" });
    await next();
  };
  const unreachable = () => {
    throw new Error("this family must not reach the organization credential chain");
  };
  return createAppRestSecurity({
    appContext: pass,
    requestLogger: () => pass,
    requestTracer: () => pass,
    legacyErrorHandler: renderUnexpected,
    canonicalErrorHandler: renderUnexpected,
    authenticateProject: () => asProject,
    // The caller holds the permission at their own project, which is all the
    // declared check ever asked for.
    authorizeProjectPermission: () => pass,
    authorizeApiKeyCeiling: () => pass,
    authenticateOrganization: unreachable,
    authorizeOrganizationPermission: unreachable,
    authorizeRouteTeamPermission: unreachable,
    authorizeRouteProjectPermission: unreachable,
    authenticateOrganizationThrowing: pass,
    authorizeOrganizationPermissionThrowing: unreachable,
  } as never);
}

function buildApi(options: { allowedAtOrganization: readonly string[] }) {
  const probed: string[] = [];
  const archive = vi.fn(async () => {
    throw new Error("the write must not run for a refused caller");
  });
  const cacheRuleUpdate = vi.fn(async () => {
    throw new Error("the write must not run for a refused caller");
  });

  const app = {
    organizationIdForProject: async () => ORGANIZATION_ID,
    actorForCredential: () => ({
      actor: { kind: "machine", projectId: PROJECT_ID },
      actorUserId: "user_1",
    }),
    authorizeOrganizationWideOperation: async (input: {
      organizationId: string;
      permission: string;
    }) => {
      probed.push(`${input.permission}@${input.organizationId}`);
      if (options.allowedAtOrganization.includes(input.permission)) return;
      throw new PermissionDeniedError({
        permission: input.permission,
        scope: { type: "organization", id: input.organizationId },
        denialReason: "no-binding",
      });
    },
    budgetDecisions: { archive, cacheRuleUpdate },
    groupMemberCounts: async () => new Map<string, number>(),
  } as unknown as GatewayApp;

  const { hono } = createGatewayPlatformRestApp({
    security: testSecurity(),
    gateway: () => app,
  });

  return {
    probed,
    archive,
    cacheRuleUpdate,
    archiveBudget: (id: string) =>
      hono.request(`/api/gateway/v1/budgets/${id}`, { method: "DELETE" }),
    updateCacheRule: (id: string) =>
      hono.request(`/api/gateway/v1/cache-rules/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ priority: 10 }),
      }),
  };
}

describe("the gateway platform family's organization-wide writes", () => {
  describe("given a project-scoped credential with no organization grant", () => {
    /** @scenario An organization-wide gateway write is authorized at the organization */
    it("refuses to archive a budget, and archives nothing", async () => {
      const api = buildApi({ allowedAtOrganization: [] });

      const response = await api.archiveBudget("budget_of_sibling_project");

      expect(response.status).toBe(403);
      await expect(response.json()).resolves.toMatchObject({
        error: { code: "permission_denied" },
      });
      expect(api.probed).toEqual([`gatewayBudgets:delete@${ORGANIZATION_ID}`]);
      expect(api.archive).not.toHaveBeenCalled();
    });

    /** @scenario An organization-wide cache-rule write is authorized at the organization */
    it("refuses to change a cache rule, and leaves it unchanged", async () => {
      const api = buildApi({ allowedAtOrganization: [] });

      const response = await api.updateCacheRule("cache_rule_1");

      expect(response.status).toBe(403);
      expect(api.probed).toEqual([`gatewayCacheRules:update@${ORGANIZATION_ID}`]);
      expect(api.cacheRuleUpdate).not.toHaveBeenCalled();
    });
  });

  describe("given a credential that holds the permission at the organization", () => {
    it("lets the write through to the service", async () => {
      const api = buildApi({ allowedAtOrganization: ["gatewayBudgets:delete"] });

      await api.archiveBudget("budget_1");

      expect(api.archive).toHaveBeenCalledWith(
        expect.objectContaining({ id: "budget_1", organizationId: ORGANIZATION_ID }),
      );
    });
  });
});
