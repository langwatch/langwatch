import type { LangWatchQLSchema } from "@langwatch/analytics-contract";
/**
 * The eval-function gate is Analytics' own answer, read from the project's
 * rollout — a caller never states it, and a statement that judges nothing
 * never pays for the read.
 * @vitest-environment node
 */
import { createApiFixture } from "@langwatch/api-fixture";
import type { AuthzApi } from "@langwatch/authz-contract";
import type { ClickHouseQueryClient } from "@langwatch/clickhouse-client";
import type { DataPrivacyApi } from "@langwatch/data-privacy-contract";
import type { EntitlementApi } from "@langwatch/entitlement-contract";
import type { FeatureFlagApi, FeatureFlagTarget } from "@langwatch/feature-flag-contract";
import { resolveRequestBound } from "@langwatch/plans";
import type { RateLimiter } from "@langwatch/process-stores/members";
import type { ProjectApi } from "@langwatch/project-contract";
import { describe, expect, it } from "vitest";

import { AnalyticsApp } from "../analytics.app.ts";

const PROJECT_ID = "project-judging";
const ORGANIZATION_ID = "org-judging";

/**
 * The app as production composes it, minus the substrate: no LangWatchQL
 * identity is provisioned, which the schema read does not need and an
 * execution answers `lwql_unavailable` from.
 */
function harness(flagAnswer: boolean) {
  const flagReads: { key: string; target: FeatureFlagTarget }[] = [];
  const app = AnalyticsApp.create({
    dependencies: {
      featureFlags: createApiFixture<FeatureFlagApi>({
        isEnabled: (key, target) => {
          flagReads.push({ key, target });

          return Promise.resolve(flagAnswer);
        },
      }),
      authz: createApiFixture<AuthzApi>(),
      dataPrivacy: createApiFixture<DataPrivacyApi>(),
      projects: createApiFixture<ProjectApi>({
        getOrganizationId: () => Promise.resolve(ORGANIZATION_ID),
      }),
      plans: createApiFixture<EntitlementApi>({
        requestBound: ({ key }) => Promise.resolve(resolveRequestBound(key, "ENTERPRISE")),
      }),
    },
    members: {
      clickhouse: createApiFixture<ClickHouseQueryClient>(),
      rateLimiter: { check: () => Promise.resolve({ allowed: true }) } satisfies RateLimiter,
      publicBaseUrl: "https://app.langwatch.test",
    },
    config: {
      langwatchQl: {
        url: void 0,
        username: void 0,
        password: void 0,
        database: void 0,
        tenantSetting: void 0,
      },
    },
    resources: { own: () => void 0, ownService: () => void 0 },
    secrets: {} as never,
  });

  const execute = (sql: string) =>
    app
      .executeLangWatchQL({
        project: { id: PROJECT_ID, lwqlKey: "lwql-key" },
        protections: {},
        sql,
      })
      .catch(() => void 0);

  return { app, execute, flagReads };
}

const appFunction = (schema: LangWatchQLSchema, name: string) =>
  schema.appFunctions.find((entry) => entry.name === name);

describe("AnalyticsApp.describeLangWatchQLSchema", () => {
  describe("given the Instant Evals flag is off for the project", () => {
    /** @scenario "The schema publishes eval functions as unavailable while they are gated" */
    it("publishes every eval function as unavailable, leaving extraction availability to permissions", async () => {
      const { app } = harness(false);

      const schema = await app.describeLangWatchQLSchema({
        projectId: PROJECT_ID,
        protections: { canSeeCapturedInput: true, canSeeCapturedOutput: true },
      });

      expect(
        schema.appFunctions
          .filter((entry) => entry.kind === "eval")
          .every((entry) => entry.available),
      ).toBe(false);
      expect(appFunction(schema, "conversation")?.available).toBe(true);
    });
  });

  describe("given the Instant Evals flag is on for the project", () => {
    it("publishes the eval functions as available", async () => {
      const { app, flagReads } = harness(true);

      const schema = await app.describeLangWatchQLSchema({
        projectId: PROJECT_ID,
        protections: {},
      });

      expect(appFunction(schema, "eval")?.available).toBe(true);
      expect(flagReads).toEqual([
        {
          key: "release_instant_evals",
          target: { kind: "project", projectId: PROJECT_ID, organizationId: ORGANIZATION_ID },
        },
      ]);
    });
  });
});

describe("AnalyticsApp.executeLangWatchQL", () => {
  describe("given a statement that calls no eval function", () => {
    it("never resolves the project's Instant Evals gate", async () => {
      const { execute, flagReads } = harness(true);

      await execute("SELECT trace_id FROM analytics.traces");

      expect(flagReads).toEqual([]);
    });
  });

  describe("given a statement that names an eval function", () => {
    it("resolves the gate on the project the statement runs for", async () => {
      const { execute, flagReads } = harness(true);

      await execute("SELECT eval(captured_output, 'is rude') AS rude FROM analytics.traces");

      expect(flagReads).toEqual([
        {
          key: "release_instant_evals",
          target: { kind: "project", projectId: PROJECT_ID, organizationId: ORGANIZATION_ID },
        },
      ]);
    });
  });
});
