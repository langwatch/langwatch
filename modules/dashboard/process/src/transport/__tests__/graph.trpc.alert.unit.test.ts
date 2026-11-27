/**
 * @vitest-environment node
 * `graphs.getById` with the alert a chart's bell renders: what it returns stays
 * inside the declared `graphDetailSchema`, whatever the stored trigger holds.
 */
import type { TrpcProcedureFactory } from "@langwatch/api/trpc";
import type { Trigger } from "@langwatch/automation-contract";
import { type DashboardApi, graphDetailSchema, graphSchema } from "@langwatch/dashboard-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { describe, expect, it } from "vitest";

import { graphTrpcTransport } from "../graph.trpc.ts";

const PROJECT_ID = "project_test";

const GRAPH = graphSchema.parse({
  id: "graph_test",
  projectId: PROJECT_ID,
  name: "Latency",
  graph: { graphType: "line" },
  filters: null,
  dashboardId: null,
  gridColumn: 0,
  gridRow: 0,
  colSpan: 4,
  rowSpan: 3,
  createdAt: new Date(0),
  updatedAt: new Date(0),
});

const TRIGGER: Trigger = {
  id: "trigger_test",
  projectId: PROJECT_ID,
  name: "Latency alert",
  triggerKind: "ALERT",
  filters: {},
  filterQuery: null,
  pausedReason: null,
  pausedAt: null,
  message: null,
  notificationCadence: "immediate",
  traceDebounceMs: 0,
  templates: {
    slackTemplateType: null,
    slackTemplate: null,
    emailSubjectTemplate: null,
    emailBodyTemplate: null,
  },
  createdAt: new Date(0),
  updatedAt: new Date(0),
  lastRunAt: null,
  active: true,
  deleted: false,
  alertType: "WARNING",
  action: "SEND_EMAIL",
  customGraphId: GRAPH.id,
  actionParams: { members: ["someone@example.com"] },
};

/** `getById` mounted over an app that holds one graph and the given trigger. */
function getByIdOver(trigger: Trigger) {
  const app = createApiFixture<DashboardApi>({
    getGraph: async () => GRAPH,
    findAlertForGraph: async () => trigger,
  });
  let getById: ((input: unknown) => Promise<unknown>) | undefined;
  const runtime: TrpcProcedureFactory<object> = {
    procedure: (request) => {
      if (request.procedure.endsWith("getById")) {
        getById = async (input) =>
          Reflect.apply(request.handle, undefined, [
            { app, input, actor: { id: "user_test" }, scope: undefined, signal: undefined },
          ]);
      }
      return {};
    },
    router: (record) => record,
  };
  graphTrpcTransport.router(runtime, () => app);
  if (getById === undefined) throw new Error("graphs.getById was not mounted");

  return getById({ projectId: PROJECT_ID, id: GRAPH.id });
}

describe("graphs.getById", () => {
  describe("given the chart's trigger carries no threshold, operator or time period", () => {
    describe("when the chart is read", () => {
      it("returns it without an alert, inside the declared output", async () => {
        const detail = await getByIdOver(TRIGGER);

        expect(graphDetailSchema.safeParse(detail).error?.issues).toBeUndefined();
        expect(graphDetailSchema.parse(detail).alert).toBeUndefined();
      });
    });
  });

  describe("given the chart's trigger carries a complete alert", () => {
    describe("when the chart is read", () => {
      it("returns the alert", async () => {
        const complete: Trigger = {
          ...TRIGGER,
          actionParams: { threshold: 10, operator: "gt", timePeriod: 60, seriesName: "p95" },
        };

        const detail = graphDetailSchema.parse(await getByIdOver(complete));

        expect(detail.alert).toMatchObject({
          threshold: 10,
          operator: "gt",
          timePeriod: 60,
          seriesName: "p95",
          triggerId: TRIGGER.id,
        });
      });
    });
  });
});
