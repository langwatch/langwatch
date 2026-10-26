/**
 * `/api/v1/dashboards` answers by the version the caller names: the Dashboards API from
 * 2026-10-26 and by default, the Reports boards for a caller pinning an earlier date, and for
 * one naming no version while Dashboards is off.
 * @see modules/dashboard/specs/dashboards-v2.feature AC199u, AC199v
 * @vitest-environment node
 */
import type { RestIdentity } from "@langwatch/api/hosting";
import { bindMiddlewareContext, recordProjectCredential, RestHost } from "@langwatch/api/rest";
import type { Actor } from "@langwatch/authorization";
import { restTestAuthorization } from "@langwatch/test-harness/trpc-members";
import { describe, expect, it } from "vitest";

import { createDashboardTestApp } from "../../app/__tests__/dashboard.fixture.ts";
import { boardRest, boardsReleased, releasedOrRefused } from "../board.rest.ts";
import { dashboardWidgetCallerSource, dashboardWidgetUrl } from "../dashboard-widget.rest.ts";
import { dashboardRestBeforeDashboardsApi } from "../dashboard.rest.ts";

const PROJECT = "project-1";
const API_KEY: Actor = { type: "api_key", id: "key-of-project-1" };

async function hostWithBothBoards({ released = true }: { released?: boolean } = {}) {
  const app = createDashboardTestApp({ publicBaseUrl: "https://app.langwatch.test" });
  const reports = await app.create({ projectId: PROJECT, name: "Reports" });
  const board = await app.createBoard({ projectId: PROJECT, name: "Usage" });
  // A served door records the key it let in: the Reports delete asks it whether to confirm.
  const admit = ({ request }: { request: Request }) => {
    recordProjectCredential(request, {
      type: "apiKey",
      apiKeyId: "key-of-project-1",
      userId: null,
      organizationId: "org-1",
      ingestSourceType: null,
      ingestionTemplateId: null,
      project: {
        id: PROJECT,
        name: "Project",
        slug: "project",
        teamId: "team-1",
        organizationId: "org-1",
        isPersonal: false,
        ownerUserId: null,
        kind: "application",
      },
    });

    return { actor: API_KEY, scope: { tier: "project" as const, id: PROJECT } };
  };
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
    bindMiddlewareContext(boardsReleased, () => releasedOrRefused(released)),
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

  const send = async (
    path: string,
    { method = "GET", body, version }: { method?: string; body?: unknown; version?: string } = {},
  ) => {
    const response = await host.app.request(path, {
      method,
      headers: {
        ...(version ? { "X-API-Version": version } : {}),
        ...(body === undefined ? {} : { "content-type": "application/json" }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const text = await response.text();

    return {
      status: response.status,
      json: (text ? JSON.parse(text) : {}) as Record<string, unknown>,
    };
  };

  return { app, reports, board, list, send };
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

describe("given a Reports board and a Dashboards board, with Dashboards switched off", () => {
  /** @scenario "AC199v Split: a caller naming no version keeps the Reports boards while Dashboards is off" */
  it("answers every Reports route at /api/v1/dashboards naming no version, as before 2026-10-26", async () => {
    const { app, reports, send } = await hostWithBothBoards({ released: false });
    const one = `/api/v1/dashboards/${reports.id}`;

    const listed = await send("/api/v1/dashboards");
    const created = await send("/api/v1/dashboards", { method: "POST", body: { name: "Made" } });
    const reordered = await send("/api/v1/dashboards/reorder", {
      method: "PUT",
      body: { dashboardIds: [String(created.json.id), reports.id] },
    });
    const read = await send(one);
    const renamed = await send(one, { method: "PATCH", body: { name: "Renamed" } });
    const deleted = await send(`/api/v1/dashboards/${String(created.json.id)}`, {
      method: "DELETE",
    });
    const left = await app.getAll({ projectId: PROJECT, graphCountScope: "builder" });

    expect({
      listed: [listed.status, (listed.json.data as { id: string }[]).map(({ id }) => id)],
      created: [created.status, "order" in created.json, created.json.name],
      reordered: [reordered.status, reordered.json],
      read: [read.status, read.json.id, "graphs" in read.json],
      renamed: [renamed.status, renamed.json.name],
      deleted: [deleted.status, deleted.json.name],
      left: left.map(({ name }) => name),
    }).toEqual({
      listed: [200, [reports.id]],
      created: [201, true, "Made"],
      reordered: [200, { success: true }],
      read: [200, reports.id, true],
      renamed: [200, "Renamed"],
      deleted: [200, "Made"],
      left: ["Renamed"],
    });
  });

  /** @scenario "AC199v Split: a caller naming no version keeps the Reports boards while Dashboards is off" */
  it("answers the bare /api/dashboards naming no version with the Reports boards too", async () => {
    const { reports, list } = await hostWithBothBoards({ released: false });

    expect(await list("/api/dashboards")).toEqual({
      status: 200,
      ids: [reports.id],
      shape: "reports",
      code: undefined,
    });
  });

  /** @scenario "AC199v Split: a caller naming no version keeps the Reports boards while Dashboards is off" */
  it("still refuses a caller pinning 2026-10-26, and leaves the widget routes 404", async () => {
    const { board, send } = await hostWithBothBoards({ released: false });

    const answers = await Promise.all([
      send("/api/v1/dashboards", { version: "2026-10-26" }),
      send("/api/v1/dashboards/2026-10-26"),
      send(`/api/v1/dashboards/${board.id}/widgets`),
    ]);

    expect(answers.map(({ status, json }) => ({ status, code: json.code }))).toEqual(
      answers.map(() => ({ status: 404, code: "dashboards_not_released" })),
    );
  });
});

describe("given a Reports board and a Dashboards board, with Dashboards switched on", () => {
  /** @scenario "AC199v Split: a caller naming no version keeps the Reports boards while Dashboards is off" */
  it("keeps answering a caller naming no version with the Dashboards API", async () => {
    const { reports, board, send } = await hostWithBothBoards();

    const read = await send(`/api/v1/dashboards/${board.id}`);
    const reportsId = await send(`/api/v1/dashboards/${reports.id}`);

    expect({
      read: [read.status, read.json.id, "scope" in read.json],
      reportsId: [reportsId.status, reportsId.json.code],
    }).toEqual({
      read: [200, board.id, true],
      reportsId: [404, "dashboard_not_found"],
    });
  });
});
