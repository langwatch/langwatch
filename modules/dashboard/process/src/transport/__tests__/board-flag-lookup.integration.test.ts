/**
 * `/api/v1/dashboards` through the dashboard module as the api installs it, with its own
 * `boardsReleased` binding: a failed `release_dashboards` lookup must never open the family.
 * @see modules/dashboard/specs/dashboards-v2.feature
 * @vitest-environment node
 */
import { AnalyticsApi } from "@langwatch/analytics-contract";
import type { RestIdentity } from "@langwatch/api/hosting";
import { recordProjectCredential, RestHost } from "@langwatch/api/rest";
import type { RestResolvedProjectCredential } from "@langwatch/authorization";
import { AuthzApi } from "@langwatch/authz-contract";
import { AutomationApi } from "@langwatch/automation-contract";
import { DashboardApi } from "@langwatch/dashboard-contract";
import { bootInstalledProcess } from "@langwatch/process";
import { memoryStores } from "@langwatch/process-stores";
import { testPeer } from "@langwatch/process/testing";
import { ProjectApi } from "@langwatch/project-contract";
import { restTestAuthorization } from "@langwatch/test-harness/trpc-members";
import { describe, expect, it } from "vitest";

import {
  createDashboardTestAnalytics,
  createDashboardTestAuthz,
  createDashboardTestAutomation,
  createDashboardTestProjects,
} from "../../app/__tests__/dashboard.fixture.ts";
import { dashboardProcessModule } from "../../dashboard.module.ts";

const PROJECT = "project-1";
const KEY_ID = "key-of-project-1";

const PROJECT_KEY: RestResolvedProjectCredential = {
  type: "apiKey",
  apiKeyId: KEY_ID,
  userId: null,
  organizationId: "organization-1",
  ingestSourceType: null,
  ingestionTemplateId: null,
  isLangySessionKey: false,
  project: {
    id: PROJECT,
    slug: "project-one",
    name: "Project one",
    teamId: "team-1",
    organizationId: "organization-1",
    isPersonal: false,
    ownerUserId: null,
    kind: "application",
  },
};

/** The installed api over memory, whose flag lookup answers `on` or fails, as `flag` says. */
async function installedApi() {
  const flag: { lookup: "on" | "fails" } = { lookup: "on" };
  const analytics = createDashboardTestAnalytics({
    isDashboardsEnabled: async () => {
      if (flag.lookup === "fails") throw new Error("feature flag lookup failed");
      return true;
    },
  });
  const admit = ({ request }: { request: Request }) => {
    recordProjectCredential(request, PROJECT_KEY);
    return {
      actor: { type: "api_key" as const, id: KEY_ID },
      scope: { tier: "project" as const, id: PROJECT },
    };
  };
  const door: RestIdentity = { authenticate: admit, identify: admit };
  let rest: RestHost | undefined;
  const mountNothing = { mount: () => {} };
  const runtime = await bootInstalledProcess({
    role: "api",
    modules: [dashboardProcessModule],
    config: { dashboard: { publicBaseUrl: "https://app.langwatch.test" } },
    stores: memoryStores(),
    peers: [
      testPeer({ token: AnalyticsApi, instance: analytics }),
      testPeer({ token: AuthzApi, instance: createDashboardTestAuthz() }),
      testPeer({ token: AutomationApi, instance: createDashboardTestAutomation() }),
      testPeer({ token: ProjectApi, instance: createDashboardTestProjects() }),
    ],
    surface: () => {
      rest = RestHost.create({
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
      return {
        hosts: { rest, trpc: mountNothing, websocket: mountNothing, rawhttp: mountNothing },
        serve: () => void 0,
      } as never;
    },
  });
  if (!rest) throw new Error("the api booted without a REST host");
  const host = rest;
  const board = await runtime
    .service(DashboardApi)
    .createBoard({ projectId: PROJECT, name: "Usage" });

  const call = async (path: string, init: { method?: string; body?: unknown } = {}) => {
    const response = await host.app.request(path, {
      method: init.method ?? "GET",
      headers: { "content-type": "application/json" },
      ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
    });
    const body = await response.text();
    return { status: response.status, leaksBoard: body.includes(board.id) };
  };

  return { runtime, flag, board, call };
}

describe("given a Dashboards board, installed as the api installs the dashboard module", () => {
  /** @scenario "Split: /api/v1/dashboards stays shut when the Dashboards flag cannot be read" */
  it("serves the board while the flag lookup answers on, so the door reaches the lookup", async () => {
    const { runtime, board, call } = await installedApi();

    try {
      expect(await call(`/api/v1/dashboards/${board.id}`)).toEqual({
        status: 200,
        leaksBoard: true,
      });
    } finally {
      await runtime.stop();
    }
  });

  /** @scenario "Split: /api/v1/dashboards stays shut when the Dashboards flag cannot be read" */
  it("answers an error and no board on every route once the flag lookup fails", async () => {
    const { runtime, flag, board, call } = await installedApi();
    flag.lookup = "fails";

    try {
      const answers = await Promise.all([
        call("/api/v1/dashboards"),
        call(`/api/v1/dashboards/${board.id}`),
        call(`/api/v1/dashboards/${board.id}/widgets`),
        call("/api/v1/dashboards", { method: "POST", body: { name: "Another" } }),
        call("/api/dashboards"),
        call(`/api/dashboards/${board.id}`),
      ]);

      expect(
        answers.map(({ status, leaksBoard }) => ({
          shut: status === 404 || status >= 500,
          leaksBoard,
        })),
      ).toEqual(answers.map(() => ({ shut: true, leaksBoard: false })));
    } finally {
      await runtime.stop();
    }
  });
});
