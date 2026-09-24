/**
 * What a key's reach decides: the query reference closes its LangWatchQL half
 * for a key that cannot run it, and only a one-project scope may judge.
 * @see specs/analytics/query-reference.feature
 * @see specs/lwql/eval-functions.feature
 * @vitest-environment node
 */
import type { LangWatchQLKeyReach } from "@langwatch/analytics-contract";
import { createApiFixture } from "@langwatch/api-fixture";
import type { AuthzApi } from "@langwatch/authz-contract";
import type { ClickHouseQueryClient } from "@langwatch/clickhouse-client";
import {
  PLATFORM_DEFAULT_DATA_PRIVACY,
  type DataPrivacyApi,
} from "@langwatch/data-privacy-contract";
import type { DataRetentionApi } from "@langwatch/data-retention-contract";
import type { EntitlementApi } from "@langwatch/entitlement-contract";
import type { FeatureFlagApi } from "@langwatch/feature-flag-contract";
import { resolveRequestBound } from "@langwatch/plans";
import type { RateLimiter } from "@langwatch/process-stores/members";
import type { Project, ProjectApi } from "@langwatch/project-contract";
import type { TraceApi } from "@langwatch/trace-contract";
import { describe, expect, it } from "vitest";

import { AnalyticsApp } from "../analytics.app.ts";

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
  flaggedProjects?: readonly string[];
}) {
  const flagsAsked: string[] = [];
  const app = await AnalyticsApp.create({
    dependencies: {
      featureFlags: createApiFixture<FeatureFlagApi>({
        isEnabled: (_key, target) => {
          const projectId = target.kind === "project" ? target.projectId : "";
          flagsAsked.push(projectId);
          return Promise.resolve(input.flaggedProjects?.includes(projectId) === true);
        },
      }),
      authz: createApiFixture<AuthzApi>({
        hasApiKeyPermission: ({ permission }) => Promise.resolve(input.grants.includes(permission)),
      }),
      dataPrivacy: createApiFixture<DataPrivacyApi>({
        getResolvedForProject: () => Promise.resolve(PLATFORM_DEFAULT_DATA_PRIVACY),
      }),
      projects: createApiFixture<ProjectApi>({
        getOrganizationId: () => Promise.resolve(ORGANIZATION_ID),
        listByOrganization: ({ limit }) =>
          Promise.resolve({
            data: [...input.listed],
            pagination: { page: 1, limit, total: input.listed.length },
          }),
      }),
      plans: createApiFixture<EntitlementApi>({
        requestBound: ({ key }) => Promise.resolve(resolveRequestBound(key, "ENTERPRISE")),
      }),
      traces: createApiFixture<TraceApi>(),
      retention: createApiFixture<DataRetentionApi>(),
    },
    members: {
      clickhouse: createApiFixture<ClickHouseQueryClient>(),
      rateLimiter: { check: () => Promise.resolve({ allowed: true }) } satisfies RateLimiter,
      publicBaseUrl: "https://app.langwatch.test",
      langwatchQl: {
        admin: { configured: false },
        postgres: { configured: false },
        database: () => {
          throw new Error("no database in this test");
        },
      },
    },
    config: {
      langwatchQl: {
        url: void 0,
        username: void 0,
        database: void 0,
        tenantSetting: void 0,
        accessModelMode: void 0,
        sqlSingleNode: void 0,
      },
    },
    resources: { own: () => void 0, ownService: () => void 0 },
    secrets: {} as never,
  });

  return { app, flagsAsked };
}

async function referenceFor(input: { listed: readonly Project[]; grants: readonly string[] }) {
  return (await appOver(input)).app.describeQueryReferenceForKey({ reach: KEY });
}

describe("AnalyticsApp.describeQueryReferenceForKey", () => {
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

describe("AnalyticsApp.describeLangWatchQLSchemaForKey", () => {
  const isEvalAvailable = (schema: {
    appFunctions: readonly { name: string; available: boolean }[];
  }) => schema.appFunctions.find((entry) => entry.name === "eval")?.available;

  describe("given a key that reads more than one project", () => {
    /** @scenario "An eval function is refused for a key that reads more than one project" */
    it("closes the eval functions without asking either project's flag", async () => {
      const { app, flagsAsked } = await appOver({
        listed: [project("project-a"), project("project-b")],
        grants: ["analytics:view"],
        flaggedProjects: ["project-a", "project-b"],
      });

      const schema = await app.describeLangWatchQLSchemaForKey({ reach: KEY });

      expect(isEvalAvailable(schema)).toBe(false);
      expect(flagsAsked).toEqual([]);
    });
  });

  describe("given a key that reads one project", () => {
    /** @scenario "A key that reads one project is judged on that project's own flag" */
    it("answers with that project's own flag", async () => {
      const flagged = await appOver({
        listed: [project("project-a")],
        grants: ["analytics:view"],
        flaggedProjects: ["project-a"],
      });
      const unflagged = await appOver({
        listed: [project("project-c")],
        grants: ["analytics:view"],
      });

      expect(
        isEvalAvailable(await flagged.app.describeLangWatchQLSchemaForKey({ reach: KEY })),
      ).toBe(true);
      expect(
        isEvalAvailable(await unflagged.app.describeLangWatchQLSchemaForKey({ reach: KEY })),
      ).toBe(false);
      expect([...flagged.flagsAsked, ...unflagged.flagsAsked]).toEqual(["project-a", "project-c"]);
    });
  });

  describe("given a key that reads no project at all", () => {
    it("closes the eval functions rather than treating an empty scope as unrestricted", async () => {
      const { app, flagsAsked } = await appOver({ listed: [], grants: ["analytics:view"] });

      expect(isEvalAvailable(await app.describeLangWatchQLSchemaForKey({ reach: KEY }))).toBe(
        false,
      );
      expect(flagsAsked).toEqual([]);
    });
  });
});
