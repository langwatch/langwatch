/**
 * The one install surface a feature directory gets: `<x>Feature = uiFeature({...})`,
 * composed by `installUiFeatures`.
 */

import { describe, expect, it } from "vitest";

import { installUiFeatures, uiFeature } from "../src/behavior/ui-feature";
import { installedUiDrawers, installedUiFeatures } from "../src/features/installed-ui-features";
import * as agentModule from "../src/features/agent";
import * as analyticsModule from "../src/features/analytics";
import * as annotationModule from "../src/features/annotation";
import * as annotationScoresModule from "../src/features/annotation-scores";
import * as apiKeyModule from "../src/features/api-key";
import * as authModule from "../src/features/auth";
import * as authorizeModule from "../src/features/authorize";
import * as authzModule from "../src/features/authz";
import * as automationsModule from "../src/features/automations";
import * as billingModule from "../src/features/billing";
import * as chromeModule from "../src/features/chrome";
import * as dataPrivacyModule from "../src/features/data-privacy";
import * as dataRetentionModule from "../src/features/data-retention";
import * as datasetModule from "../src/features/dataset";
import * as evaluationsModule from "../src/features/evaluations";
import * as evaluatorModule from "../src/features/evaluator";
import * as experimentsModule from "../src/features/experiments";
import * as gatewayModule from "../src/features/gateway";
import * as githubModule from "../src/features/github";
import * as governanceModule from "../src/features/governance";
import * as homeModule from "../src/features/home";
import * as langyModule from "../src/features/langy";
import * as licensingModule from "../src/features/licensing";
import * as modelProviderModule from "../src/features/model-provider";
import * as monitorModule from "../src/features/monitor";
import * as navigationModule from "../src/features/navigation";
import * as notificationModule from "../src/features/notification";
import * as onboardingModule from "../src/features/onboarding";
import * as opsModule from "../src/features/ops";
import * as organizationModule from "../src/features/organization";
import * as personalWorkspaceModule from "../src/features/personal-workspace";
import * as projectModule from "../src/features/project";
import * as promptModule from "../src/features/prompt";
import * as scimModule from "../src/features/scim";
import * as secretModule from "../src/features/secret";
import * as simulationsModule from "../src/features/simulations";
import * as topicModule from "../src/features/topic";
import * as tracesModule from "../src/features/traces";
import * as workflowsModule from "../src/features/workflows";

/**
 * Every directory under `src/features` with an `index.ts`, except `drawers/` — it holds
 * the trace-drawer funnel and address helpers the chrome imports directly, and never
 * composed a Feature of its own even before this change (see the design's Files table).
 */
const featureModules: Record<string, Record<string, unknown>> = {
  agent: agentModule,
  analytics: analyticsModule,
  annotation: annotationModule,
  "annotation-scores": annotationScoresModule,
  "api-key": apiKeyModule,
  auth: authModule,
  authorize: authorizeModule,
  authz: authzModule,
  automations: automationsModule,
  billing: billingModule,
  chrome: chromeModule,
  "data-privacy": dataPrivacyModule,
  "data-retention": dataRetentionModule,
  dataset: datasetModule,
  evaluations: evaluationsModule,
  evaluator: evaluatorModule,
  experiments: experimentsModule,
  gateway: gatewayModule,
  github: githubModule,
  governance: governanceModule,
  home: homeModule,
  langy: langyModule,
  licensing: licensingModule,
  "model-provider": modelProviderModule,
  monitor: monitorModule,
  navigation: navigationModule,
  notification: notificationModule,
  onboarding: onboardingModule,
  ops: opsModule,
  organization: organizationModule,
  "personal-workspace": personalWorkspaceModule,
  project: projectModule,
  prompt: promptModule,
  scim: scimModule,
  secret: secretModule,
  simulations: simulationsModule,
  topic: topicModule,
  traces: tracesModule,
  workflows: workflowsModule,
};

/** Every export from a feature module whose name ends in "Feature". */
function featureExportsOf(module: Record<string, unknown>): Record<string, unknown>[] {
  return Object.entries(module)
    .filter(([name]) => name.endsWith("Feature"))
    .map(([, value]) => value as Record<string, unknown>);
}

describe("given the feature directories under apps/ui/src/features", () => {
  describe("when the installed feature list is composed", () => {
    /** @scenario "A new feature cannot be half-registered" */
    it("registers every exported feature value, so a new feature cannot be half-registered", () => {
      for (const [directory, module] of Object.entries(featureModules)) {
        const exported = featureExportsOf(module);
        expect(exported.length, `${directory}/index.ts exports no *Feature value`).toBeGreaterThan(
          0,
        );

        for (const feature of exported) {
          for (const key of Object.keys(feature.loaders as Record<string, unknown>)) {
            expect(
              Object.keys(installedUiFeatures.loaders ?? {}),
              `page key "${key}" from ${directory} is not in the installed loaders`,
            ).toContain(key);
          }

          for (const key of Object.keys(feature.drawers as Record<string, unknown>)) {
            expect(
              Object.keys(installedUiDrawers),
              `drawer "${key}" from ${directory} is not in the installed drawers`,
            ).toContain(key);
          }

          const api = feature.api as { name: string } | undefined;
          if (api) {
            const names = (installedUiFeatures.apis ?? []).map((binding) => binding.name);
            expect(names, `api "${api.name}" from ${directory} is not installed`).toContain(
              api.name,
            );
          }
        }
      }
    });
  });
});

describe("given two features whose loaders both answer the same page key", () => {
  describe("when they are composed with installUiFeatures", () => {
    /** @scenario "Two features serving the same page key are refused by name" */
    it("throws, naming both features and the shared page key", () => {
      const loader = () => Promise.resolve({ default: () => null });
      const first = uiFeature({ name: "@langwatch/first-web", loaders: { shared: loader } });
      const second = uiFeature({ name: "@langwatch/second-web", loaders: { shared: loader } });

      let thrown: unknown;
      try {
        installUiFeatures({ features: [first, second] });
      } catch (error) {
        thrown = error;
      }

      expect(thrown).toBeInstanceOf(Error);
      const message = (thrown as Error).message;
      expect(message).toContain("shared");
      expect(message).toContain("@langwatch/first-web");
      expect(message).toContain("@langwatch/second-web");
    });
  });
});

describe("given two features whose drawers both answer the same drawer name", () => {
  describe("when they are composed with installUiFeatures", () => {
    /** @scenario "Two features serving the same drawer name are refused by name" */
    it("throws, naming both features and the shared drawer name", () => {
      const drawer = () => null;
      const first = uiFeature({ name: "@langwatch/first-web", drawers: { shared: drawer } });
      const second = uiFeature({ name: "@langwatch/second-web", drawers: { shared: drawer } });

      let thrown: unknown;
      try {
        installUiFeatures({ features: [first, second] });
      } catch (error) {
        thrown = error;
      }

      expect(thrown).toBeInstanceOf(Error);
      const message = (thrown as Error).message;
      expect(message).toContain("shared");
      expect(message).toContain("@langwatch/first-web");
      expect(message).toContain("@langwatch/second-web");
    });
  });
});

describe("given a feature built with no api binding", () => {
  describe("when it is composed with installUiFeatures", () => {
    /** @scenario "A feature without an api still serves its pages" */
    it("contributes no Provider and its own page loaders still resolve", () => {
      const loader = () => Promise.resolve({ default: () => null });
      const feature = uiFeature({ name: "@langwatch/no-api-web", loaders: { onlyPage: loader } });

      const installed = installUiFeatures({ features: [feature] });

      expect(installed.apis).toHaveLength(0);
      expect(installed.loaders?.onlyPage).toBe(loader);
    });
  });
});
