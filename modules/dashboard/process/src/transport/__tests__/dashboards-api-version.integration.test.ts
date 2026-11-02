/**
 * `/api/v1/dashboards` is the Dashboards API from 2026-10-26 and by default; an earlier date finds
 * nothing there, and the Reports boards answer only at `/api/v1/analytics/reports`. Its bare
 * `/api/dashboards` twin answers the same and says it is deprecated.
 * @see modules/dashboard/specs/dashboards-v2.feature AC199u, AC199v
 * @vitest-environment node
 */
import type { RestIdentity } from "@langwatch/api/hosting";
import { bindMiddlewareContext, RestHost } from "@langwatch/api/rest";
import type { Actor } from "@langwatch/authorization";
import { restTestAuthorization } from "@langwatch/test-harness/trpc-members";
import { describe, expect, it } from "vitest";

import { createDashboardTestApp } from "../../app/__tests__/dashboard.fixture.ts";
import { boardRest, boardsReleased, releasedOrRefused } from "../board.rest.ts";
import { dashboardWidgetCaller, dashboardWidgetUrl } from "../dashboard-widget.rest.ts";
import { dashboardRest } from "../dashboard.rest.ts";

const PROJECT = "project-1";
const API_KEY: Actor = { type: "api_key", id: "key-of-project-1" };
const SUCCESSOR = '</api/v1/dashboards>; rel="successor-version"';

async function hostWithBothBoards({ released = true }: { released?: boolean } = {}) {
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
    bindMiddlewareContext(boardsReleased, () => releasedOrRefused(released)),
    bindMiddlewareContext(dashboardWidgetUrl, () => "https://app.langwatch.test/dashboards"),
    bindMiddlewareContext(dashboardWidgetCaller, () => ({ source: { kind: "api" as const } })),
  ];

  for (const family of [dashboardRest, boardRest]) {
    host.mount(family.router(), () => app, { middlewareBindings });
  }

  const call = async (path: string, version?: string) => {
    const response = await host.app.request(path, {
      headers: version ? { "X-API-Version": version } : {},
    });
    const text = await response.text();

    return {
      status: response.status,
      body: text,
      json: (text.startsWith("{") ? JSON.parse(text) : {}) as {
        data?: { id: string; graphCount?: number; widgetCount?: number }[];
        code?: string;
      },
      deprecation: response.headers.get("Deprecation"),
      link: response.headers.get("Link"),
    };
  };

  const list = async (path: string, version?: string) => {
    const { status, json } = await call(path, version);

    return {
      status,
      ids: json.data?.map(({ id }) => id),
      shape: json.data?.[0] && ("widgetCount" in json.data[0] ? "dashboards" : "reports"),
      code: json.code,
    };
  };

  return { reports, board, list, call };
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
  it("finds nothing for a caller pinning 2026-08-07, by header or by URL", async () => {
    const { list } = await hostWithBothBoards();

    const answers = await Promise.all([
      list("/api/v1/dashboards", "2026-08-07"),
      list("/api/v1/dashboards/2026-08-07"),
      list("/api/dashboards", "2026-09-30"),
    ]);

    expect(answers.map(({ status, ids }) => ({ status, ids }))).toEqual(
      answers.map(() => ({ status: 404, ids: undefined })),
    );
  });

  /** @scenario "AC199u Split: /api/v1/dashboards answers by the API version the caller names" */
  it("lists the Reports board only at /api/v1/analytics/reports, whatever the date", async () => {
    const { reports, list } = await hostWithBothBoards();

    const answers = await Promise.all([
      list("/api/v1/analytics/reports"),
      list("/api/v1/analytics/reports", "2026-08-07"),
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

describe("given /api/dashboards, the bare twin of /api/v1/dashboards", () => {
  const addresses = (boardId: string) => [
    "",
    "/2026-10-26",
    "/latest",
    `/${boardId}`,
    `/${boardId}/widgets`,
  ];

  /** @scenario "AC199v Split: /api/dashboards answers as /api/v1/dashboards, deprecated" */
  it("answers as /api/v1/dashboards, naming it as the successor", async () => {
    const { board, call } = await hostWithBothBoards();
    const rests = addresses(board.id);

    const bare = await Promise.all(rests.map((rest) => call(`/api/dashboards${rest}`)));
    const twin = await Promise.all(rests.map((rest) => call(`/api/v1/dashboards${rest}`)));

    expect(bare.map(({ status, body }) => ({ status, body }))).toEqual(
      twin.map(({ status, body }) => ({ status, body })),
    );
    expect(bare.map(({ status }) => status)).toEqual(rests.map(() => 200));
    expect(bare.map(({ deprecation, link }) => ({ deprecation, link }))).toEqual(
      rests.map(() => ({ deprecation: "true", link: SUCCESSOR })),
    );
  });

  /** @scenario "AC199v Split: /api/dashboards answers as /api/v1/dashboards, deprecated" */
  it("carries no deprecation header on any /api/v1/dashboards answer", async () => {
    const { board, call } = await hostWithBothBoards();

    const twin = await Promise.all(
      addresses(board.id).map((rest) => call(`/api/v1/dashboards${rest}`)),
    );

    expect(twin.map(({ deprecation }) => deprecation)).toEqual(twin.map(() => null));
  });

  /** @scenario "AC199v Split: /api/dashboards answers as /api/v1/dashboards, deprecated" */
  it("says so on its 404 while Dashboards is switched off", async () => {
    const { call } = await hostWithBothBoards({ released: false });

    const refused = await call("/api/dashboards");

    expect({
      status: refused.status,
      code: refused.json.code,
      deprecation: refused.deprecation,
      link: refused.link,
    }).toEqual({
      status: 404,
      code: "dashboards_not_released",
      deprecation: "true",
      link: SUCCESSOR,
    });
  });
});
