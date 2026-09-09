/**
 * The dashboard tRPC wire, pinned: every procedure name, its kind, and the
 * permission the server binds to it. A rename here is a cache-key change in
 * every browser that calls it.
 *
 * Spec: modules/dashboard/specs/dashboard-service.feature.
 */
import type { AuthzPermission } from "@langwatch/authz-contract";
import type { TrpcProcedureFactory, TrpcProcedureRequest } from "@langwatch/api/trpc";
import {
  dashboardTrpc,
  graphTrpc,
  savedViewTrpc,
  savedWorkbenchChartTrpc,
  type DashboardApi,
} from "@langwatch/dashboard-contract";
import { describe, expect, it } from "vitest";

import { createDashboardTestApp } from "../../app/__tests__/dashboard.fixture.ts";
import { dashboardTrpcTransport } from "../dashboard.trpc.ts";
import { graphTrpcTransport } from "../graph.trpc.ts";
import { savedViewTrpcTransport } from "../saved-view.trpc.ts";
import { savedWorkbenchChartTrpcTransport } from "../saved-workbench-chart.trpc.ts";

type Context = { app: { dashboard: DashboardApi } };

/** Mounts a declaration and records what each procedure asked for. */
function mounted(declaration: {
  router: (runtime: TrpcProcedureFactory<Context>, app: (ctx: Context) => DashboardApi) => unknown;
}) {
  const requests: TrpcProcedureRequest<Context>[] = [];
  const runtime: TrpcProcedureFactory<Context> = {
    procedure: (request) => {
      requests.push(request);
      return {};
    },
    router: (record) => record,
  };

  declaration.router(runtime, (ctx) => ctx.app.dashboard);

  return requests;
}

const permissionsOf = (requests: TrpcProcedureRequest<Context>[]): (AuthzPermission | object)[] =>
  requests.map((request) =>
    request.access.kind === "permission" ? request.access.permission : request.access,
  );

const tableOf = (
  contract: { members: Record<string, { kind: string }> },
  requests: TrpcProcedureRequest<Context>[],
) =>
  Object.entries(contract.members).map(([name, member], index) => [
    name,
    member.kind,
    permissionsOf(requests)[index],
  ]);

describe("the dashboard tRPC declarations", () => {
  describe("given the contract and the server it is bound to", () => {
    it("keeps the dashboards wire names, kinds and permissions", () => {
      expect(tableOf(dashboardTrpc, mounted(dashboardTrpcTransport))).toEqual([
        ["getAll", "query", "analytics:view"],
        ["getById", "query", "analytics:view"],
        ["create", "mutation", "analytics:create"],
        ["rename", "mutation", "analytics:update"],
        ["delete", "mutation", "analytics:delete"],
        ["reorderDashboards", "mutation", "analytics:update"],
        ["getOrCreateFirst", "query", "analytics:view"],
      ]);
    });

    it("keeps the graphs wire names, kinds and permissions", () => {
      expect(tableOf(graphTrpc, mounted(graphTrpcTransport))).toEqual([
        ["create", "mutation", "analytics:create"],
        ["getAll", "query", "analytics:view"],
        ["delete", "mutation", "analytics:delete"],
        ["getById", "query", "analytics:view"],
        ["updateById", "mutation", "analytics:update"],
        ["updateLayout", "mutation", "analytics:update"],
        ["batchUpdateLayouts", "mutation", "analytics:update"],
      ]);
    });

    it("keeps every saved view under the right to read traces", () => {
      expect(tableOf(savedViewTrpc, mounted(savedViewTrpcTransport))).toEqual([
        ["getAll", "query", "traces:view"],
        ["create", "mutation", "traces:view"],
        ["delete", "mutation", "traces:view"],
        ["rename", "mutation", "traces:view"],
        ["reorder", "mutation", "traces:view"],
      ]);
    });

    /** @scenario "Compatibility transports share one service instance" */
    it("declares the analytics permission on every saved workbench chart procedure", () => {
      expect(permissionsOf(mounted(savedWorkbenchChartTrpcTransport))).toEqual([
        "analytics:view",
        "analytics:view",
        "analytics:create",
        "analytics:update",
        "analytics:view",
        "analytics:delete",
      ]);
      expect(Object.keys(savedWorkbenchChartTrpc.members)).toEqual([
        "getAll",
        "getById",
        "create",
        "update",
        "run",
        "delete",
      ]);
    });
  });

  describe("given several procedures handled in one process", () => {
    /** @scenario "Compatibility transports share one service instance" */
    it("answers all of them from the application context's own Dashboard capability", () => {
      const app = createDashboardTestApp();
      const context = { app: { dashboard: app } };

      const resolved = mounted(savedWorkbenchChartTrpcTransport).map((request) =>
        request.app(context),
      );

      expect(resolved).toHaveLength(6);
      expect(resolved.every((reached) => reached === app)).toBe(true);
    });
  });
});
