/**
 * Every LangWatchQL door reaches the one placement gate, and a routed project's key-map row is
 * written through the LangWatchQL admin target only (ADR-200).
 * Spec: specs/lwql/isolation.feature
 * @vitest-environment node
 */
import type { LangWatchQLKeyReach } from "@langwatch/analytics-contract";
import type { AuthzApi } from "@langwatch/authz-contract";
import {
  PLATFORM_DEFAULT_DATA_PRIVACY,
  type DataPrivacyApi,
} from "@langwatch/data-privacy-contract";
import type { DataRetentionApi } from "@langwatch/data-retention-contract";
import type { EntitlementApi } from "@langwatch/entitlement-contract";
import type { FeatureFlagApi } from "@langwatch/feature-flag-contract";
import type { InstantEvalApi } from "@langwatch/instant-eval-contract";
import { resolveRequestBound } from "@langwatch/plans";
import type { Project, ProjectApi } from "@langwatch/project-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import type { TraceApi } from "@langwatch/trace-contract";
import { describe, expect, it, vi } from "vitest";

import type { AnalyticsSessionsRepository } from "../../repositories/analytics-sessions.repository.ts";
import type { ClickHouseAdminStatements } from "../../repositories/langwatch-ql-provisioning.repository.ts";
import { MemoryAnalyticsRepositories } from "../../repositories/memory/memory.analytics.repositories.ts";
import { MemoryLangWatchQLPlacementRepository } from "../../repositories/memory/memory.langwatch-ql-placement.repository.ts";
import { AnalyticsModule } from "../analytics.app.ts";
import { analyticsTestSecrets, TEST_SESSION_SECRET } from "./analytics-secrets.fixture.ts";
import { EVERY_CATALOGUE_PERMISSION } from "./analytics.fixture.ts";

const { queryMock } = vi.hoisted(() => ({ queryMock: vi.fn() }));

vi.mock("@clickhouse/client", () => ({
  createClient: () => ({ query: queryMock, close: async () => undefined }),
}));

const ORGANIZATION_ID = "org-routed";
const ROUTED = "project-routed";
const SHARED = "project-shared";
/** One project per organisation: a key door with no project named reads every one it may. */
const ORGANIZATION_OF: Readonly<Record<string, string>> = {
  [ROUTED]: ORGANIZATION_ID,
  [SHARED]: "org-shared",
};
/** The LangWatchQL server's origin, as the admin target below names it. */
const TARGET_ORIGIN = "http://clickhouse.test:8123";

function project(id: string): Project {
  return {
    id,
    name: id,
    slug: id,
    apiKey: `legacy-${id}`,
    lwqlKey: `lwql-${id}`,
    teamId: `team-${id}`,
    language: "en",
    framework: "other",
    kind: "application",
    firstMessage: false,
    integrated: false,
    createdAt: new Date(0),
    updatedAt: new Date(0),
    userLinkTemplate: null,
    traceSharingEnabled: false,
    presenceEnabled: false,
    s3Endpoint: null,
    s3AccessKeyId: null,
    s3SecretAccessKey: null,
    s3Bucket: null,
    archivedAt: null,
    isPersonal: false,
    ownerUserId: null,
    personalFeatures: {},
    departmentId: null,
    langyEgressAllowlist: null,
    lastCodingAgentSessionAt: null,
    lastCodingAgentPullRequestAt: null,
  };
}

const keyFor = (projectId: string): LangWatchQLKeyReach => ({
  kind: "apiKey",
  apiKeyId: `key-${projectId}`,
  userId: null,
  organizationId: ORGANIZATION_OF[projectId] ?? ORGANIZATION_ID,
  resolvedProject: { id: projectId, teamId: `team-${projectId}` },
});

/**
 * The app with a provisioned identity and admin seam: `project-routed` on its own ClickHouse,
 * `project-shared` on the LangWatchQL server, whose access model is answered provisioned.
 */
async function appOver() {
  const inserts: Parameters<ClickHouseAdminStatements["insert"]>[0][] = [];
  const admin: ClickHouseAdminStatements = {
    command: () => Promise.resolve(),
    rows: () => Promise.resolve([]),
    insert: (input) => {
      inserts.push(input);
      return Promise.resolve();
    },
  };
  const resolveSession = vi.fn<AnalyticsSessionsRepository["resolve"]>(() =>
    Promise.reject(new Error("a tenant's routed client was asked for")),
  );
  const memory = MemoryAnalyticsRepositories.create();
  await memory.lwqlAccessModelAnswer.recordAnswer({ origin: TARGET_ORIGIN, answer: "provisioned" });
  const app = await AnalyticsModule.create({
    dependencies: {
      featureFlags: createApiFixture<FeatureFlagApi>({ isEnabled: () => Promise.resolve(false) }),
      authz: createApiFixture<AuthzApi>({
        hasApiKeyPermission: () => Promise.resolve(true),
        can: () => Promise.resolve(true),
        canBatchPermissionsByIds: ({ permissions, teams, projects }) =>
          Promise.resolve({
            organizationRole: null,
            byPermission: new Map(
              permissions.map((permission) => [
                permission,
                {
                  teams: new Map(teams.map(({ teamId }) => [teamId, true])),
                  projects: new Map(projects.map(({ projectId }) => [projectId, true])),
                },
              ]),
            ),
          }),
      }),
      dataPrivacy: createApiFixture<DataPrivacyApi>({
        getResolvedForProject: () => Promise.resolve(PLATFORM_DEFAULT_DATA_PRIVACY),
      }),
      projects: createApiFixture<ProjectApi>({
        getOrganizationId: () => Promise.resolve(ORGANIZATION_ID),
        findById: (id) => Promise.resolve([ROUTED, SHARED].includes(id) ? project(id) : null),
        listByOrganization: ({ organizationId, limit }) =>
          Promise.resolve({
            data: [ROUTED, SHARED]
              .filter((id) => ORGANIZATION_OF[id] === organizationId)
              .map((id) => project(id)),
            pagination: { page: 1, limit, total: 1 },
          }),
      }),
      plans: createApiFixture<EntitlementApi>({
        requestBound: ({ key }) => Promise.resolve(resolveRequestBound(key, "ENTERPRISE")),
      }),
      traces: createApiFixture<TraceApi>(),
      retention: createApiFixture<DataRetentionApi>(),
    },
    channels: { judge: createApiFixture<InstantEvalApi>() },
    repositories: {
      ...memory,
      sessions: { resolve: resolveSession },
      lwqlPlacement: MemoryLangWatchQLPlacementRepository.create({
        routedTenants: [ROUTED],
        sharedOrigin: TARGET_ORIGIN,
      }),
      langWatchQl: {
        ...memory.langWatchQl,
        admin: {
          configured: true,
          target: { url: "http://clickhouse.test:8123/", database: "langwatch" },
          statements: admin,
        },
      },
    },
    config: {
      langwatchQl: {
        url: void 0,
        username: void 0,
        database: void 0,
        tenantSetting: void 0,
        postgresHost: void 0,
        accessModelMode: void 0,
        sqlSingleNode: void 0,
        clickhouseCluster: void 0,
        aggregateMaxMembers: void 0,
      },
      tenantAnalyticsConcurrency: 4,
      publicBaseUrl: "https://app.langwatch.test",
    },
    resources: { own: () => void 0, ownService: () => void 0 },
    secrets: analyticsTestSecrets({
      NEXTAUTH_SECRET: TEST_SESSION_SECRET,
      LWQL_CLICKHOUSE_PASSWORD: "lwql-test-password",
    }),
  });
  return { app, inserts, resolveSession };
}

function codeOf(run: Promise<unknown>): Promise<string> {
  return run.then(
    () => "answered",
    (error: unknown) =>
      error instanceof Error && "code" in error ? String(error.code) : String(error),
  );
}

const SQL = "SELECT 1";
const PROTECTIONS = { catalogue: EVERY_CATALOGUE_PERMISSION };

/** What each door answers for one project: a refusal's code, or `answered`. */
async function everyDoorFor({ projectId }: { projectId: string }) {
  const { app } = await appOver();
  const reach = keyFor(projectId);
  const project = { id: projectId, lwqlKey: `lwql-${projectId}` };
  const run = (caller: "workbench" | "saved_chart") =>
    codeOf(
      app.executeLangWatchQL({
        project,
        protections: PROTECTIONS,
        sql: SQL,
        telemetry: { caller },
      }),
    );
  return {
    api: await codeOf(app.runLangWatchQLForKey({ reach, door: "rest_api", sql: SQL })),
    cli: await codeOf(app.runLangWatchQLForKey({ reach, door: "cli", sql: SQL })),
    workbench: await run("workbench"),
    savedChart: await run("saved_chart"),
    pass: await codeOf(
      app.executeLangWatchQLPass({
        project,
        protections: PROTECTIONS,
        sql: SQL,
        pass: { kind: "probe" },
        isInstantEvalsEnabled: false,
      }),
    ),
  };
}

describe("AnalyticsModule LangWatchQL doors", () => {
  describe("when each door runs a query for an organisation routed to its own ClickHouse", () => {
    /** @scenario "Every LangWatchQL entry point passes the gate" */
    it("refuses lwql_not_provisioned at the API, the CLI verbs, the workbench, saved charts and passes", async () => {
      queryMock.mockReset();

      expect(await everyDoorFor({ projectId: ROUTED })).toEqual({
        api: "lwql_not_provisioned",
        cli: "lwql_not_provisioned",
        workbench: "lwql_not_provisioned",
        savedChart: "lwql_not_provisioned",
        pass: "lwql_not_provisioned",
      });
      expect(queryMock).not.toHaveBeenCalled();
    });
  });

  describe("when each door runs a query for a shared project on the LangWatchQL server", () => {
    /** @scenario "Every LangWatchQL entry point passes the gate" */
    it("admits it at every door, so the refusal above is the gate's and not the fixture's", async () => {
      queryMock.mockReset();
      queryMock.mockResolvedValue({
        json: async () => ({
          data: [{ one: 1 }],
          meta: [{ name: "one", type: "UInt8" }],
          statistics: { elapsed: 0, rows_read: 1, bytes_read: 1 },
        }),
      });

      expect(await everyDoorFor({ projectId: SHARED })).toEqual({
        api: "answered",
        cli: "answered",
        workbench: "answered",
        savedChart: "answered",
        pass: "answered",
      });
      expect(queryMock).toHaveBeenCalledTimes(5);
    });
  });
});

describe("AnalyticsModule.syncLwqlKeyMapRow", () => {
  describe("given a project whose organisation is routed to its own ClickHouse", () => {
    /** @scenario "A routed project's key-map row is written only to the LangWatchQL server" */
    it("writes the row through the LangWatchQL admin target and never asks for the tenant's client", async () => {
      const { app, inserts, resolveSession } = await appOver();

      await app.syncLwqlKeyMapRow({ projectId: ROUTED });

      expect(
        inserts.map(({ table, rows }) => ({ table, tenants: rows.map((r) => r.TenantId) })),
      ).toEqual([{ table: "langwatch.lwql_api_key_tenant_map", tenants: [ROUTED] }]);
      expect(resolveSession).not.toHaveBeenCalled();
    });
  });
});
