import type { LangWatchQLSchema } from "@langwatch/analytics-contract";
import type { AuthzApi } from "@langwatch/authz-contract";
import type { DataPrivacyApi } from "@langwatch/data-privacy-contract";
import type { DataRetentionApi } from "@langwatch/data-retention-contract";
import type { EntitlementApi } from "@langwatch/entitlement-contract";
import type { FeatureFlagApi, FeatureFlagTarget } from "@langwatch/feature-flag-contract";
import type { InstantEvalApi } from "@langwatch/instant-eval-contract";
import { resolveRequestBound } from "@langwatch/plans";
import type { ProjectApi } from "@langwatch/project-contract";
/**
 * The eval-function gate on a member's statement is Instant Evals' answer, never the release
 * flag, and a statement that judges nothing never pays for the read. A pass takes the answer
 * its caller states. @vitest-environment node
 */
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import type { TraceApi } from "@langwatch/trace-contract";
import { describe, expect, it } from "vitest";

import { MemoryAnalyticsRepositories } from "../../repositories/memory/memory.analytics.repositories.ts";
import { EVERY_CATALOGUE_PERMISSION } from "../../services/__tests__/lwql-catalogue-access.fixture.ts";
import { AnalyticsModule } from "../analytics.app.ts";
import { analyticsTestSecrets } from "./analytics-secrets.fixture.ts";

const PROJECT_ID = "project-judging";
const ORGANIZATION_ID = "org-judging";

/**
 * The app as production composes it, minus the substrate: no LangWatchQL
 * identity is provisioned, which the schema read does not need and an
 * execution answers `lwql_unavailable` from.
 */
async function harness({ flagAnswer, enabled }: { flagAnswer: boolean; enabled: boolean }) {
  const flagReads: { key: string; target: FeatureFlagTarget }[] = [];
  const accessAsked: string[] = [];
  const app = await AnalyticsModule.create({
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
      traces: createApiFixture<TraceApi>(),
      retention: createApiFixture<DataRetentionApi>(),
    },
    channels: {
      judge: createApiFixture<InstantEvalApi>({
        isEnabled: ({ projectId }) => {
          accessAsked.push(projectId);
          return Promise.resolve(enabled);
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
        aggregateMaxMembers: void 0,
      },
      tenantAnalyticsConcurrency: 4,
      publicBaseUrl: "https://app.langwatch.test",
    },
    resources: { own: () => void 0, ownService: () => void 0 },
    secrets: analyticsTestSecrets(),
  });

  const execute = (sql: string) =>
    app
      .executeLangWatchQL({
        project: { id: PROJECT_ID, lwqlKey: "lwql-key" },
        protections: { catalogue: EVERY_CATALOGUE_PERMISSION },
        sql,
      })
      .catch(() => void 0);

  return { app, execute, flagReads, accessAsked };
}

const appFunction = (schema: LangWatchQLSchema, name: string) =>
  schema.appFunctions.find((entry) => entry.name === name);

describe("AnalyticsModule.describeLangWatchQLSchema", () => {
  describe("given Instant Evals are not enabled for the project", () => {
    /** @scenario "The schema publishes eval functions as unavailable while they are gated" */
    it("publishes every eval function as unavailable, leaving extraction availability to permissions", async () => {
      const { app } = await harness({ flagAnswer: true, enabled: false });

      const schema = await app.describeLangWatchQLSchema({
        projectId: PROJECT_ID,
        protections: {
          catalogue: EVERY_CATALOGUE_PERMISSION,
          canSeeCapturedInput: true,
          canSeeCapturedOutput: true,
        },
      });

      expect(
        schema.appFunctions
          .filter((entry) => entry.kind === "eval")
          .every((entry) => entry.available),
      ).toBe(false);
      expect(appFunction(schema, "conversation")?.available).toBe(true);
    });
  });

  describe("given the release flag is off and Instant Evals are enabled for the project", () => {
    /** @scenario "Eval functions open on Instant Evals' own answer, not on the release flag" */
    it("publishes the eval functions as available without reading the flag", async () => {
      const { app, flagReads, accessAsked } = await harness({ flagAnswer: false, enabled: true });

      const schema = await app.describeLangWatchQLSchema({
        projectId: PROJECT_ID,
        protections: { catalogue: EVERY_CATALOGUE_PERMISSION },
      });

      expect(appFunction(schema, "eval")?.available).toBe(true);
      expect(accessAsked).toEqual([PROJECT_ID]);
      expect(flagReads).toEqual([]);
    });
  });
});

describe("AnalyticsModule.executeLangWatchQL", () => {
  describe("given a statement that calls no eval function", () => {
    it("never asks Instant Evals whether the project may judge", async () => {
      const { execute, accessAsked } = await harness({ flagAnswer: true, enabled: true });

      await execute("SELECT trace_id FROM analytics.traces");

      expect(accessAsked).toEqual([]);
    });
  });

  describe("given a statement that names an eval function, with the release flag off", () => {
    /** @scenario "Eval functions open on Instant Evals' own answer, not on the release flag" */
    it("asks Instant Evals for the project the statement runs for, never the flag", async () => {
      const { execute, flagReads, accessAsked } = await harness({
        flagAnswer: false,
        enabled: true,
      });

      await execute("SELECT eval(captured_output, 'is rude') AS rude FROM analytics.traces");

      expect(accessAsked).toEqual([PROJECT_ID]);
      expect(flagReads).toEqual([]);
    });
  });
});

describe("AnalyticsModule.executeLangWatchQLPass", () => {
  const pass = (app: AnalyticsModule, isInstantEvalsEnabled: boolean) =>
    app.executeLangWatchQLPass({
      project: { id: PROJECT_ID, lwqlKey: "lwql-key" },
      protections: { catalogue: EVERY_CATALOGUE_PERMISSION },
      sql: "SELECT TraceId, eval(TraceName, 'is it rude?') AS rude FROM analytics.traces",
      pass: { kind: "probe" },
      isInstantEvalsEnabled,
    });

  describe("given a caller that says eval functions are refused, with the flag on", () => {
    /** @scenario "Every read a run makes carries Instant Evals' own answer to whether eval functions may run" */
    it("refuses the eval call without reading the flag", async () => {
      const { app, flagReads } = await harness({ flagAnswer: true, enabled: true });

      await expect(pass(app, false)).rejects.toMatchObject({ code: "lwql_not_permitted" });
      expect(flagReads).toEqual([]);
    });
  });

  describe("given a caller that says eval functions are allowed, with the flag off", () => {
    /** @scenario "Every read a run makes carries Instant Evals' own answer to whether eval functions may run" */
    it("admits the eval call without reading the flag", async () => {
      const { app, flagReads } = await harness({ flagAnswer: false, enabled: false });

      const refusal: unknown = await pass(app, true).catch((error: unknown) => error);

      expect(refusal).not.toMatchObject({ code: "lwql_not_permitted" });
      expect(flagReads).toEqual([]);
    });
  });
});
