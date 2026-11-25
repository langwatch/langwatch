/**
 * What a key's reach decides: the query reference closes its LangWatchQL half
 * for a key that cannot run it, and only a one-project scope may judge.
 * @see specs/analytics/query-reference.feature
 * @see specs/lwql/eval-functions.feature
 * @see specs/lwql/api.feature
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
import type * as Observability from "@langwatch/observability";
import { resolveRequestBound } from "@langwatch/plans";
import type { Project, ProjectApi } from "@langwatch/project-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import type { TraceApi } from "@langwatch/trace-contract";
import { describe, expect, it, vi } from "vitest";

import { MemoryAnalyticsRepositories } from "../../repositories/memory/memory.analytics.repositories.ts";
import { EVERY_CATALOGUE_PERMISSION } from "../../services/__tests__/lwql-catalogue-access.fixture.ts";
import { AnalyticsModule } from "../analytics.app.ts";
import { analyticsTestSecrets } from "./analytics-secrets.fixture.ts";

const logged = await vi.hoisted(async () => {
  const { createTestLogger } = await import("@langwatch/test-harness");
  return createTestLogger();
});

vi.mock("@langwatch/observability", async (importActual) => {
  const actual = await importActual<typeof Observability>();
  return { ...actual, createLogger: () => logged.logger };
});

const ORGANIZATION_ID = "org-1";
const PROJECT_ID = "project-123";

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

const KEY: LangWatchQLKeyReach = {
  kind: "apiKey",
  apiKeyId: "key-123",
  userId: null,
  organizationId: ORGANIZATION_ID,
  resolvedProject: { id: PROJECT_ID, teamId: `team-${PROJECT_ID}` },
};

/** The app over an organization of `listed` projects, the key granted exactly `grants`. */
async function appOver(input: {
  listed: readonly Project[];
  grants: readonly string[];
  enabledProjects?: readonly string[];
}) {
  const accessAsked: string[] = [];
  const keysAsked: string[] = [];
  const peopleAsked: string[] = [];
  const app = await AnalyticsModule.create({
    dependencies: {
      featureFlags: createApiFixture<FeatureFlagApi>(),
      authz: createApiFixture<AuthzApi>({
        hasApiKeyPermission: ({ apiKeyId, permission }) => {
          keysAsked.push(apiKeyId);
          return Promise.resolve(input.grants.includes(permission));
        },
        can: ({ principal, permission, scope }) => {
          peopleAsked.push(
            `${principal.type}:${"id" in principal ? principal.id : ""}@${"id" in scope ? scope.id : ""}`,
          );
          return Promise.resolve(input.grants.includes(permission));
        },
        hasPermission: ({ permission }) => Promise.resolve(input.grants.includes(permission)),
        getScope: ({ projectId }) =>
          Promise.resolve({
            type: "project",
            id: projectId ?? PROJECT_ID,
            teamId: `team-${projectId}`,
            organizationId: ORGANIZATION_ID,
          }),
        canBatchByIds: ({ projects }) =>
          Promise.resolve({
            organizationRole: null,
            teams: new Map(),
            projects: new Map(
              projects.map(({ projectId }) => [projectId, input.grants.includes("analytics:view")]),
            ),
          }),
        canBatchPermissionsByIds: ({ permissions, teams, projects }) =>
          Promise.resolve({
            organizationRole: null,
            byPermission: new Map(
              permissions.map((permission) => {
                const held = input.grants.includes(permission);
                return [
                  permission,
                  {
                    teams: new Map(teams.map(({ teamId }) => [teamId, held])),
                    projects: new Map(projects.map(({ projectId }) => [projectId, held])),
                  },
                ];
              }),
            ),
          }),
      }),
      dataPrivacy: createApiFixture<DataPrivacyApi>({
        getResolvedForProject: () => Promise.resolve(PLATFORM_DEFAULT_DATA_PRIVACY),
      }),
      projects: createApiFixture<ProjectApi>({
        getOrganizationId: () => Promise.resolve(ORGANIZATION_ID),
        findOrganizationId: () => Promise.resolve(ORGANIZATION_ID),
        listByOrganization: ({ limit, projectIds }) => {
          const data = input.listed.filter(({ id }) => !projectIds || projectIds.includes(id));
          return Promise.resolve({ data, pagination: { page: 1, limit, total: data.length } });
        },
      }),
      plans: createApiFixture<EntitlementApi>({
        requestBound: ({ key }) => Promise.resolve(resolveRequestBound(key, "ENTERPRISE")),
      }),
      traces: createApiFixture<TraceApi>(),
      retention: createApiFixture<DataRetentionApi>(),
    },
    channels: {
      judge: createApiFixture<InstantEvalApi>({
        isEnabled: ({ projectId }) => {
          accessAsked.push(projectId);
          return Promise.resolve(input.enabledProjects?.includes(projectId) === true);
        },
      }),
    },
    repositories: MemoryAnalyticsRepositories.create(),
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
        installMethod: void 0,
        aggregateMaxMembers: void 0,
      },
      tenantAnalyticsConcurrency: 4,
      publicBaseUrl: "https://app.langwatch.test",
    },
    resources: { own: () => void 0, ownService: () => void 0 },
    secrets: analyticsTestSecrets(),
  });

  return { app, accessAsked, keysAsked, peopleAsked };
}

async function referenceFor(input: { listed: readonly Project[]; grants: readonly string[] }) {
  return (await appOver(input)).app.describeQueryReferenceForKey({ reach: KEY });
}

describe("AnalyticsModule.describeQueryReferenceForKey", () => {
  describe("when the key holds analytics:view on a readable project", () => {
    /** @scenario "A key holding analytics:view reads the reference" */
    it("describes both query languages in one payload", async () => {
      const reference = await referenceFor({
        listed: [project(PROJECT_ID)],
        grants: ["analytics:view", "traces:view"],
      });

      expect(reference.lwql.enabled).toBe(true);
      expect(reference.lwql.schema.views.length).toBeGreaterThan(0);
      expect(reference.lwql.endpoints.length).toBeGreaterThan(0);
      expect(reference.traceFilter.fields.length).toBeGreaterThan(0);
      expect(reference.traceFilter.syntax).toContain("trace.attribute.");
      expect(reference.decisionTable.length).toBeGreaterThan(0);
      expect(
        [...new Set(reference.examples.map((example) => example.language))].toSorted(),
      ).toEqual(["lwql", "trace-filter"]);
    });

    /** @scenario "The reference embeds the very schema the schema endpoint publishes" */
    it("embeds the very schema the schema endpoint publishes", async () => {
      const input = { listed: [project(PROJECT_ID)], grants: ["analytics:view", "traces:view"] };
      const reference = await referenceFor(input);
      const schema = await (
        await appOver(input)
      ).app.describeLangWatchQLSchemaForKey({ reach: KEY });

      expect(reference.lwql.schema).toEqual(schema);
    });
  });

  describe("when the key is scoped to traces but not analytics", () => {
    /** @scenario 'A key entitled only to traces still reads the filter vocabulary' */
    it("answers the filter half in full and closes the LangWatchQL half", async () => {
      const reference = await referenceFor({
        listed: [project(PROJECT_ID)],
        grants: ["traces:view"],
      });

      expect(reference.traceFilter.fields.length).toBeGreaterThan(0);
      expect(reference.traceFilter.syntax).toContain("trace.attribute.");
      expect(reference.lwql.enabled).toBe(false);
      expect(reference.lwql.schema.views).toEqual([]);
      expect(
        reference.examples
          .filter((example) => example.language === "lwql")
          .every((example) => !example.available),
      ).toBe(true);
    });

    it("keeps the filter examples runnable", async () => {
      const reference = await referenceFor({
        listed: [project(PROJECT_ID)],
        grants: ["traces:view"],
      });
      const filters = reference.examples.filter((example) => example.language === "trace-filter");

      expect(filters.length).toBeGreaterThan(0);
      expect(filters.every((example) => example.available)).toBe(true);
    });
  });

  describe("when the key clears analytics:view but reads no project", () => {
    it("closes the LangWatchQL half and keeps the filter half", async () => {
      const reference = await referenceFor({ listed: [], grants: ["analytics:view"] });

      expect(reference.lwql.enabled).toBe(false);
      expect(reference.lwql.schema.views).toEqual([]);
      expect(reference.traceFilter.fields.length).toBeGreaterThan(0);
    });
  });
});

describe("AnalyticsModule.describeLangWatchQLSchemaForKey", () => {
  const isEvalAvailable = (schema: {
    appFunctions: readonly { name: string; available: boolean }[];
  }) => schema.appFunctions.find((entry) => entry.name === "eval")?.available;

  describe("given a key that reads more than one project", () => {
    /** @scenario "An eval function is refused for a key that reads more than one project" */
    it("closes the eval functions without asking either project", async () => {
      const { app, accessAsked } = await appOver({
        listed: [project("project-a"), project("project-b")],
        grants: ["analytics:view"],
        enabledProjects: ["project-a", "project-b"],
      });

      const schema = await app.describeLangWatchQLSchemaForKey({ reach: KEY });

      expect(isEvalAvailable(schema)).toBe(false);
      expect(accessAsked).toEqual([]);
    });
  });

  describe("given a key that reads one project", () => {
    /** @scenario "A key that reads one project is judged on that project's own Instant Evals access" */
    it("answers with that project's own Instant Evals access", async () => {
      const enabled = await appOver({
        listed: [project("project-a")],
        grants: ["analytics:view"],
        enabledProjects: ["project-a"],
      });
      const disabled = await appOver({
        listed: [project("project-c")],
        grants: ["analytics:view"],
      });

      expect(
        isEvalAvailable(await enabled.app.describeLangWatchQLSchemaForKey({ reach: KEY })),
      ).toBe(true);
      expect(
        isEvalAvailable(await disabled.app.describeLangWatchQLSchemaForKey({ reach: KEY })),
      ).toBe(false);
      expect([...enabled.accessAsked, ...disabled.accessAsked]).toEqual(["project-a", "project-c"]);
    });
  });

  describe("given a key that reads no project at all", () => {
    it("closes the eval functions rather than treating an empty scope as unrestricted", async () => {
      const { app, accessAsked } = await appOver({ listed: [], grants: ["analytics:view"] });

      expect(isEvalAvailable(await app.describeLangWatchQLSchemaForKey({ reach: KEY }))).toBe(
        false,
      );
      expect(accessAsked).toEqual([]);
    });
  });
});

describe("AnalyticsModule.runLangWatchQLForKey", () => {
  describe("when the body names a project the key cannot read", () => {
    /** @scenario "A run naming a project the key cannot read is refused as not found" */
    it("refuses before the statement reaches the engine", async () => {
      const { app } = await appOver({
        listed: [project("project-a"), project("project-b")],
        grants: ["analytics:view"],
      });

      await expect(
        app.runLangWatchQLForKey({
          reach: KEY,
          sql: "SELECT count() FROM analytics.traces",
          projectId: "project-elsewhere",
        }),
      ).rejects.toMatchObject({ code: "project_not_found" });
    });
  });

  describe("when an organisation-wide key runs over all projects and the engine fails", () => {
    /** @scenario "Telemetry: a failed query is logged at its fault's level with the projects it ran over" */
    it("names the projects its scope resolved to on the failed-run line", async () => {
      logged.lines.length = 0;
      const { app } = await appOver({
        listed: [project("project-a"), project("project-b")],
        grants: ["analytics:view"],
      });

      await expect(
        app.runLangWatchQLForKey({
          reach: { ...KEY, resolvedProject: undefined },
          sql: "SELECT count() FROM analytics.traces",
          projects: "all",
        }),
      ).rejects.toBeDefined();

      const failed = logged.lines.findLine("warn", "LangWatchQL failed");
      expect(failed).toMatchObject({ projectIds: ["project-a", "project-b"] });
    });
  });
});

const TOKEN: LangWatchQLKeyReach = {
  kind: "cliAccessToken",
  userId: "admin-1",
  organizationId: ORGANIZATION_ID,
  projectId: "project-a",
  teamId: "team-project-a",
};

describe("given a project-bound access token, the hosted MCP's OAuth sign-in", () => {
  describe("when its person holds analytics:view on the bound project", () => {
    /** @scenario "A project-bound access token runs a LangWatchQL query as its person" */
    it("opens the reference's LangWatchQL half, judged as the person and never as a key", async () => {
      const { app, keysAsked, peopleAsked } = await appOver({
        listed: [project("project-a")],
        grants: ["analytics:view", "traces:view"],
      });

      const reference = await app.describeQueryReferenceForKey({ reach: TOKEN });

      expect(reference.lwql.enabled).toBe(true);
      expect(keysAsked).toEqual([]);
      expect(new Set(peopleAsked)).toEqual(
        new Set(["user:admin-1@project-a", `user:admin-1@${ORGANIZATION_ID}`]),
      );
    });
  });

  describe("when its person lacks analytics:view on the bound project", () => {
    /** @scenario "A project-bound access token runs a LangWatchQL query as its person" */
    it("closes the reference's LangWatchQL half, as it is closed to that person", async () => {
      const { app } = await appOver({ listed: [project("project-a")], grants: ["traces:view"] });

      const reference = await app.describeQueryReferenceForKey({ reach: TOKEN });

      expect(reference.lwql.enabled).toBe(false);
    });
  });

  describe("when its run names a project other than the bound one", () => {
    /** @scenario "A project-bound access token reads only the project it is bound to" */
    it("refuses as not found, though the person can read that project", async () => {
      const { app } = await appOver({
        listed: [project("project-a"), project("project-b")],
        grants: ["analytics:view"],
      });

      await expect(
        app.runLangWatchQLForKey({
          reach: TOKEN,
          sql: "SELECT count() FROM analytics.traces",
          projectId: "project-b",
        }),
      ).rejects.toMatchObject({ code: "project_not_found" });
    });
  });

  describe("when it runs over every project it can read and the engine fails", () => {
    /** @scenario "A project-bound access token reads only the project it is bound to" */
    it("ran over the bound project alone", async () => {
      logged.lines.length = 0;
      const { app, peopleAsked } = await appOver({
        listed: [project("project-a"), project("project-b")],
        grants: ["analytics:view"],
      });

      await expect(
        app.runLangWatchQLForKey({
          reach: TOKEN,
          sql: "SELECT count() FROM analytics.traces",
          projects: "all",
        }),
      ).rejects.toBeDefined();

      const failed = logged.lines.findLine("warn", "LangWatchQL failed");
      expect(failed).toMatchObject({ projectIds: ["project-a"] });
      expect(peopleAsked.some((asked) => asked.endsWith("@project-b"))).toBe(false);
    });
  });
});

describe("AnalyticsModule.executeLangWatchQL", () => {
  describe("when a member's run names projects other than its own and the engine fails", () => {
    /** @scenario "Telemetry: a failed query is logged at its fault's level with the projects it ran over" */
    it("names the projects its scope resolved to on the failed-run line", async () => {
      logged.lines.length = 0;
      const { app } = await appOver({
        listed: [project("project-a"), project("project-b"), project("project-c")],
        grants: ["analytics:view"],
      });

      await expect(
        app.executeLangWatchQL({
          project: { id: "project-a", lwqlKey: "lwql-project-a" },
          protections: { catalogue: EVERY_CATALOGUE_PERMISSION },
          sql: "SELECT count() FROM analytics.traces",
          projects: ["project-b", "project-c"],
          userId: "member-1",
        }),
      ).rejects.toBeDefined();

      const failed = logged.lines.findLine("warn", "LangWatchQL failed");
      expect(failed).toMatchObject({ projectIds: ["project-b", "project-c"] });
    });
  });
});
