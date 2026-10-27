/**
 * `/api/v1/dashboards` answers by the version the caller names: the Dashboards API from
 * 2026-10-26 and by default, the Reports boards for a caller pinning an earlier date.
 * @see modules/dashboard/specs/dashboards-v2.feature AC199u
 * @vitest-environment node
 */
import type { RestIdentity } from "@langwatch/api/hosting";
import { bindMiddlewareContext, RestHost } from "@langwatch/api/rest";
import type { Actor } from "@langwatch/authorization";
import { restTestAuthorization } from "@langwatch/test-harness/trpc-members";
import { describe, expect, it } from "vitest";

import { createDashboardTestApp } from "../../app/__tests__/dashboard.fixture.ts";
import { boardRest, boardsReleased } from "../board.rest.ts";
import { dashboardWidgetCallerSource, dashboardWidgetUrl } from "../dashboard-widget.rest.ts";
import { dashboardRestBeforeDashboardsApi } from "../dashboard.rest.ts";

const PROJECT = "project-1";
const API_KEY: Actor = { type: "api_key", id: "key-of-project-1" };

async function hostWithBothBoards() {
  const app = createDashboardTestApp({ publicBaseUrl: "https://app.langwatch.test" });
  const reports = await app.create({ projectId: PROJECT, name: "Reports" });
  const board = await app.createBoard({ projectId: PROJECT, name: "Usage" });
  const admit = () => ({ actor: API_KEY, scope: { tier: "project" as const, id: PROJECT } });
  const door: RestIdentity = { authenticate: admit, identify: admit };
  const host = RestHost.create({
    identities: {
      project: door,
      organization: door,
      api_key: door,
      instance_admin: door,
      browser: door,
    },
    authz: restTestAuthorization().forRequest(),
    audit: { record: async () => {} },
  });
  const middlewareBindings = [
    bindMiddlewareContext(boardsReleased, () => true as const),
    bindMiddlewareContext(dashboardWidgetUrl, () => "https://app.langwatch.test/dashboards"),
    bindMiddlewareContext(dashboardWidgetCallerSource, () => ({ kind: "api" as const })),
  ];

  for (const family of [dashboardRestBeforeDashboardsApi, boardRest]) {
    host.mount(family.router(), () => app, { middlewareBindings });
  }

  const list = async (path: string, version?: string) => {
    const response = await host.app.request(path, {
      headers: version ? { "X-API-Version": version } : {},
    });
    const json = (await response.json()) as {
      data?: { id: string; graphCount?: number; widgetCount?: number }[];
      code?: string;
    };

    return {
      status: response.status,
      ids: json.data?.map(({ id }) => id),
      shape: json.data?.[0] && ("widgetCount" in json.data[0] ? "dashboards" : "reports"),
      code: json.code,
    };
  };

  return { reports, board, list };
}

describe("given a Reports board and a Dashboards board, with Dashboards switched on", () => {
  /** @scenario "AC199u Split: /api/v1/dashboards answers by the API version the caller names" */
  it("lists the Dashboards board by default and for 2026-10-26", async () => {
    const { board, list } = await hostWithBothBoards();

    const answers = await Promise.all([
      list("/api/v1/dashboards"),
      list("/api/v1/dashboards", "2026-10-26"),
      list("/api/v1/dashboards/2026-10-26"),
    ]);

    expect(answers).toEqual(
      answers.map(() => ({ status: 200, ids: [board.id], shape: "dashboards", code: undefined })),
    );
  });

  /** @scenario "AC199u Split: /api/v1/dashboards answers by the API version the caller names" */
  it("lists the Reports board for a caller pinning 2026-08-07, by header or by URL", async () => {
    const { reports, list } = await hostWithBothBoards();

    const answers = await Promise.all([
      list("/api/v1/dashboards", "2026-08-07"),
      list("/api/v1/dashboards/2026-08-07"),
      list("/api/dashboards", "2026-09-30"),
    ]);

    expect(answers).toEqual(
      answers.map(() => ({ status: 200, ids: [reports.id], shape: "reports", code: undefined })),
    );
  });

  /** @scenario "AC199u Split: /api/v1/dashboards answers by the API version the caller names" */
  it("refuses a version that is not a real date", async () => {
    const { list } = await hostWithBothBoards();

    const refused = await list("/api/v1/dashboards", "next-week");

    expect({ status: refused.status, code: refused.code }).toEqual({
      status: 400,
      code: "invalid_api_version",
    });
  });
});
