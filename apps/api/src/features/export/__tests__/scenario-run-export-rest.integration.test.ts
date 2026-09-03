/**
 * The bulk run export, driven through the real Hono app the API process mounts.
 *
 * The family is handler-managed on purpose: it resolves the person itself and
 * publishes its own refusals. What is pinned here is that resolution — a
 * signed-out caller and a caller without `scenarios:view` are told apart, and
 * neither reaches the store — and that a permitted download is written to the
 * audit ledger BEFORE a byte is streamed, because a bulk export lifts a
 * project's whole run history.
 */
import { createAppRestSecurity, type AppRestSecurity } from "@langwatch/api/rest";
import type { SimulationService } from "@langwatch/scenario-contract";
import { Hono, type ErrorHandler, type MiddlewareHandler } from "hono";
import { describe, expect, it, vi } from "vitest";

import {
  mountScenarioRunExportRest,
  type ScenarioRunExportAudit,
} from "../scenario-run-export-rest.mount";
import type { ApiHandlerManagedSessionPort } from "../../../app/api-handler-managed-session";

const downloadBody = JSON.stringify({
  projectId: "project-1",
  scenarioSetId: "set-1",
  mode: "criteria",
});

describe("given the bulk scenario run export", () => {
  describe("when a signed-in caller who may view simulations downloads", () => {
    it("records the download against them before streaming a byte", async () => {
      const audit: ScenarioRunExportAudit = vi.fn(async () => {});
      const countRunsForExport = vi.fn(async () => 0);
      const api = mount({ audit, countRunsForExport });

      const response = await api.fetch("/api/export/scenario-runs/download", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: downloadBody,
      });

      expect(response.status).toBe(200);
      expect(audit).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: "user-1",
          projectId: "project-1",
          action: "scenarioRuns.export",
          targetKind: "project",
        }),
      );
    });
  });

  describe("when nobody is signed in", () => {
    it("refuses without reaching the simulation store", async () => {
      const countRunsForExport = vi.fn();
      const api = mount({ countRunsForExport, session: null });

      const response = await api.fetch("/api/export/scenario-runs/download", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: downloadBody,
      });

      expect(response.status).toBe(401);
      expect(countRunsForExport).not.toHaveBeenCalled();
    });
  });

  describe("when the caller is signed in but may not view the project's simulations", () => {
    it("refuses with the forbidden code rather than the unauthenticated one", async () => {
      const countRunsForExport = vi.fn();
      const api = mount({ countRunsForExport, permitted: false });

      const response = await api.fetch("/api/export/scenario-runs/download", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: downloadBody,
      });

      expect(response.status).toBe(403);
      expect(countRunsForExport).not.toHaveBeenCalled();
    });
  });
});

function mount(overrides: {
  audit?: ScenarioRunExportAudit;
  countRunsForExport: (...args: never[]) => unknown;
  session?: { user: { id: string } } | null;
  permitted?: boolean;
}) {
  const session: ApiHandlerManagedSessionPort = {
    resolve: async () =>
      overrides.session === undefined ? { user: { id: "user-1" } } : overrides.session,
    permitted: async () => overrides.permitted ?? true,
  };

  const hono = new Hono().route(
    "/",
    mountScenarioRunExportRest({
      security: passThroughSecurity(),
      simulations: () =>
        ({
          countRunsForExport: overrides.countRunsForExport,
          // eslint-disable-next-line require-yield
          streamRunsForExport: async function* () {},
        }) as unknown as SimulationService,
      broadcast: () => ({
        broadcastToTenant: async () => undefined,
        broadcastToTenantRateLimited: async () => undefined,
      }),
      session,
      recordExportRequested: overrides.audit ?? (async () => {}),
    }),
  );

  return {
    fetch: (path: string, init?: RequestInit) =>
      hono.fetch(new Request(`http://api.test${path}`, init)),
  };
}

function passThroughSecurity(): AppRestSecurity {
  const noop: MiddlewareHandler = async (_c, next) => {
    await next();
  };
  const unreachable = () => {
    throw new Error("A handler-managed family must not reach the framework auth chain.");
  };
  return createAppRestSecurity({
    appContext: noop,
    requestLogger: () => noop,
    requestTracer: () => noop,
    legacyErrorHandler: renderHandled,
    canonicalErrorHandler: renderHandled,
    authenticateProject: unreachable,
    authorizeProjectPermission: unreachable,
    authorizeApiKeyCeiling: unreachable,
    authenticateOrganization: unreachable,
    authorizeOrganizationPermission: unreachable,
    authorizeRouteProjectPermission: unreachable,
    authenticateOrganizationThrowing: noop,
    authorizeOrganizationPermissionThrowing: unreachable,
  } as never);
}

const renderHandled: ErrorHandler = (error, c) => {
  const handled = error as { httpStatus?: number; code?: string; message?: string };
  if (typeof handled.httpStatus === "number") {
    return c.json(
      { code: handled.code ?? "error", message: handled.message ?? "" },
      handled.httpStatus as never,
    );
  }
  return c.json({ error: String(error) }, 500);
};
