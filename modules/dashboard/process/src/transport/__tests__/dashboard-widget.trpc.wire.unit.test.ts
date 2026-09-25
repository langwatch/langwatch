/**
 * @vitest-environment node
 * The custom-chart playground's `dashboardWidgets.*` wire, as main served it.
 * Spec: custom-chart-playground-dashboard-placement.feature.
 */
import { CustomChartPlaygroundNotEnabledError } from "@langwatch/analytics-contract";
import type { TrpcProcedureFactory, TrpcProcedureRequest } from "@langwatch/api/trpc";
import {
  dashboardWidgetTrpcRowSchema,
  dashboardWidgetTrpcSchema,
  type DashboardApi,
} from "@langwatch/dashboard-contract";
import { describe, expect, it } from "vitest";

import {
  createDashboardTestAnalytics,
  createDashboardTestApp,
} from "../../app/__tests__/dashboard.fixture.ts";
import { dashboardWidgetTrpcTransport } from "../dashboard-widget.trpc.ts";

type Context = object;
type Invoke = (args: {
  app: DashboardApi;
  input: unknown;
  actor: { id: string };
  scope: { tier: "project"; id: string };
  signal: undefined;
}) => unknown;

const PROJECT_ID = "project-1";
const WIDGET = {
  projectId: PROJECT_ID,
  name: "Usage",
  code: "export default () => null;",
  queries: [{ name: "usage", sql: "SELECT 1" }],
};

/** Mounted on a runtime that records each request and keeps its handler callable. */
function mounted(app: DashboardApi) {
  const requests: TrpcProcedureRequest<Context>[] = [];
  const callers = new Map<string, (input: unknown) => Promise<unknown>>();
  const runtime: TrpcProcedureFactory<Context> = {
    procedure: (request) => {
      requests.push(request);
      const invoke: Invoke = (args) => Reflect.apply(request.handle, undefined, [args]);
      const name = request.procedure.split(".").at(-1) ?? request.procedure;
      callers.set(name, async (input) =>
        invoke({
          app,
          input,
          actor: { id: "user_1" },
          scope: { tier: "project", id: PROJECT_ID },
          signal: undefined,
        }),
      );
      return {};
    },
    router: (record) => record,
  };

  dashboardWidgetTrpcTransport.router(runtime, () => app);

  const call = (name: string, input: unknown): Promise<unknown> => {
    const caller = callers.get(name);
    if (caller === undefined) throw new Error(`no procedure ${name}`);
    return caller(input);
  };

  return { requests, call };
}

describe("the dashboard widgets tRPC namespace", () => {
  describe("when the process root composes it", () => {
    it("serves list, create, update, updateLayout, batchUpdateLayouts, assignDashboard and delete under dashboardWidgets with main's permissions", () => {
      const { requests } = mounted(createDashboardTestApp());

      expect(
        requests.map((request) => [
          request.procedure,
          request.member.kind,
          request.access.kind === "permission" ? request.access.permission : request.access,
        ]),
      ).toEqual([
        ["dashboardWidgets.list", "query", "analytics:view"],
        ["dashboardWidgets.create", "mutation", "analytics:create"],
        ["dashboardWidgets.update", "mutation", "analytics:update"],
        ["dashboardWidgets.updateLayout", "mutation", "analytics:update"],
        ["dashboardWidgets.batchUpdateLayouts", "mutation", "analytics:update"],
        ["dashboardWidgets.assignDashboard", "mutation", "analytics:update"],
        ["dashboardWidgets.delete", "mutation", "analytics:delete"],
      ]);
    });
  });

  describe("when the create drawer saves a widget on a dashboard", () => {
    /** @scenario "The create drawer places a new widget on the dashboard it names through dashboardWidgets.create" */
    it("places it on that dashboard and answers main's widget shape", async () => {
      const { call } = mounted(createDashboardTestApp());

      const created = dashboardWidgetTrpcSchema.parse(
        await call("create", { ...WIDGET, dashboardId: "dashboard-1" }),
      );

      expect(created).toMatchObject({ name: "Usage", dashboardId: "dashboard-1" });
      expect(created.createdAt).toBeInstanceOf(Date);
    });
  });

  describe("when the playground lists the project's widgets", () => {
    it("answers main's stored chart rows, the definition under graph", async () => {
      const { call } = mounted(createDashboardTestApp());
      await call("create", WIDGET);

      const rows = dashboardWidgetTrpcRowSchema
        .array()
        .parse(await call("list", { projectId: PROJECT_ID }));

      expect(rows).toEqual([
        expect.objectContaining({
          name: "Usage",
          kind: "dashboard_srcdoc",
          filters: null,
          graph: { version: 1, code: WIDGET.code, queries: WIDGET.queries },
        }),
      ]);
    });
  });

  describe("when the update and assignDashboard mutations succeed", () => {
    it("answers success, as main did", async () => {
      const { call } = mounted(createDashboardTestApp());
      const created = dashboardWidgetTrpcSchema.parse(await call("create", WIDGET));

      await expect(
        call("update", { ...WIDGET, id: created.id, code: "export default () => <div />;" }),
      ).resolves.toEqual({ success: true });
      await expect(
        call("assignDashboard", {
          projectId: PROJECT_ID,
          id: created.id,
          dashboardId: "dashboard-1",
        }),
      ).resolves.toEqual({ success: true });
    });
  });

  describe("when the grid moves or resizes widgets", () => {
    const LAYOUT = { gridColumn: 2, gridRow: 5, colSpan: 3, rowSpan: 4 };

    it("stores one widget's new placement and answers success, as main did", async () => {
      const { call } = mounted(createDashboardTestApp());
      const created = dashboardWidgetTrpcSchema.parse(await call("create", WIDGET));

      await expect(
        call("updateLayout", { projectId: PROJECT_ID, graphId: created.id, ...LAYOUT }),
      ).resolves.toEqual({ success: true });
      await expect(call("list", { projectId: PROJECT_ID })).resolves.toEqual([
        expect.objectContaining({ id: created.id, ...LAYOUT }),
      ]);
    });

    it("stores every placement in a batch and answers success, as main did", async () => {
      const { call } = mounted(createDashboardTestApp());
      const first = dashboardWidgetTrpcSchema.parse(await call("create", WIDGET));
      const second = dashboardWidgetTrpcSchema.parse(await call("create", WIDGET));

      await expect(
        call("batchUpdateLayouts", {
          projectId: PROJECT_ID,
          layouts: [
            { graphId: first.id, ...LAYOUT, gridRow: 10 },
            { graphId: second.id, ...LAYOUT, gridRow: 0 },
          ],
        }),
      ).resolves.toEqual({ success: true });
      await expect(call("list", { projectId: PROJECT_ID })).resolves.toEqual([
        expect.objectContaining({ id: second.id, ...LAYOUT, gridRow: 0 }),
        expect.objectContaining({ id: first.id, ...LAYOUT, gridRow: 10 }),
      ]);
    });

    it("answers success for an id naming no widget and changes nothing, as main did", async () => {
      const { call } = mounted(createDashboardTestApp());
      const created = dashboardWidgetTrpcSchema.parse(await call("create", WIDGET));

      await expect(
        call("updateLayout", { projectId: PROJECT_ID, graphId: "widget-missing", ...LAYOUT }),
      ).resolves.toEqual({ success: true });
      await expect(
        call("batchUpdateLayouts", {
          projectId: PROJECT_ID,
          layouts: [{ graphId: "widget-missing", ...LAYOUT }],
        }),
      ).resolves.toEqual({ success: true });
      await expect(call("list", { projectId: PROJECT_ID })).resolves.toEqual([
        expect.objectContaining({ id: created.id, gridColumn: created.gridColumn }),
      ]);
    });
  });

  describe("when the delete mutation removes a widget", () => {
    it("answers success, as main did, and the widget is gone from the list", async () => {
      const { call } = mounted(createDashboardTestApp());
      const created = dashboardWidgetTrpcSchema.parse(await call("create", WIDGET));

      await expect(call("delete", { projectId: PROJECT_ID, id: created.id })).resolves.toEqual({
        success: true,
      });
      await expect(call("list", { projectId: PROJECT_ID })).resolves.toEqual([]);
    });
  });

  describe("when the project has the custom-chart playground switched off", () => {
    /** @scenario "Every dashboard widget procedure is refused while the custom-chart playground is off" */
    it("refuses every widget procedure with the playground's own code", async () => {
      const analytics = createDashboardTestAnalytics({
        assertCustomChartPlaygroundEnabled: async () => {
          throw new CustomChartPlaygroundNotEnabledError();
        },
      });
      const { call } = mounted(createDashboardTestApp({ dependencies: { analytics } }));
      const code = new CustomChartPlaygroundNotEnabledError().code;

      await expect(call("list", { projectId: PROJECT_ID })).rejects.toMatchObject({ code });
      await expect(call("create", WIDGET)).rejects.toMatchObject({ code });
      await expect(call("update", { ...WIDGET, id: "widget-1" })).rejects.toMatchObject({ code });
      await expect(
        call("updateLayout", { projectId: PROJECT_ID, graphId: "widget-1", gridColumn: 0 }),
      ).rejects.toMatchObject({ code });
      await expect(
        call("batchUpdateLayouts", { projectId: PROJECT_ID, layouts: [] }),
      ).rejects.toMatchObject({ code });
      await expect(
        call("assignDashboard", { projectId: PROJECT_ID, id: "widget-1", dashboardId: "d" }),
      ).rejects.toMatchObject({ code });
      await expect(call("delete", { projectId: PROJECT_ID, id: "widget-1" })).rejects.toMatchObject(
        { code },
      );
    });
  });
});
