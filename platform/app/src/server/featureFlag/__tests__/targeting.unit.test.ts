/**
 * @vitest-environment node
 *
 * The targeting identity of a feature flag read: both scopes are stated,
 * and a caller with no such scope says so.
 *
 * @see specs/ops/internal-feature-flags.feature
 */
import { describe, expect, it, vi } from "vitest";
import { FeatureFlagService } from "../featureFlag.service";
import type { FeatureFlagStorePostgres } from "../featureFlagStore.postgres";
import {
  evaluateRules,
  type FeatureFlagRules,
  type RuleEvaluationContext,
} from "../rules";
import { NOT_TARGETED, toRuleContextId } from "../targeting";
import type {
  FeatureFlagEvaluateOptions,
  FeatureFlagServiceInterface,
} from "../types";

const PRODUCT_FLAG = "release_ui_agent_testing_v2_enabled";

function buildService({
  enabled,
  rules,
}: {
  enabled: boolean;
  rules: FeatureFlagRules;
}) {
  const legacy: FeatureFlagServiceInterface = {
    isEnabled: vi.fn().mockResolvedValue(false),
  };
  const store = {
    async get(
      _key: string,
      ctx: RuleEvaluationContext = {},
    ): Promise<boolean | null> {
      return evaluateRules(rules, ctx) ?? enabled;
    },
  };
  return new FeatureFlagService({
    legacy,
    store: store as unknown as FeatureFlagStorePostgres,
  });
}

describe("feature flag targeting", () => {
  describe("given a read that leaves a scope out", () => {
    /** @scenario "a read that omits an id does not compile" */
    it("is rejected by the type of the options", () => {
      // @ts-expect-error organizationId is required on every flag read.
      const withoutOrganization: FeatureFlagEvaluateOptions = {
        distinctId: "user-1",
        projectId: "project-1",
      };
      // @ts-expect-error projectId is required on every flag read.
      const withoutProject: FeatureFlagEvaluateOptions = {
        distinctId: "user-1",
        organizationId: "organization-1",
      };

      expect(withoutOrganization.distinctId).toBe("user-1");
      expect(withoutProject.distinctId).toBe("user-1");
    });
  });

  describe("given a surface that has no project of its own", () => {
    /** @scenario "a caller with no project of its own opts that scope out by name" */
    it("states the exported opt-out value for the project", () => {
      const options: FeatureFlagEvaluateOptions = {
        distinctId: "user-1",
        projectId: NOT_TARGETED,
        organizationId: "organization-1",
      };

      expect(options.projectId).toBe(NOT_TARGETED);
      expect(toRuleContextId(options.projectId)).toBeUndefined();
    });

    /** @scenario "an opted-out scope matches no rule that names that scope" */
    it("matches no rule that names a project", () => {
      const rules: FeatureFlagRules = [
        { match: { projectId: "project-1" }, enabled: true },
      ];

      const hit = evaluateRules(rules, {
        projectId: toRuleContextId(NOT_TARGETED),
        organizationId: toRuleContextId("organization-1"),
      });

      expect(hit).toBeNull();
    });
  });

  describe("given an id that is not known yet", () => {
    /** @scenario "an id that is not known yet is written out, not left out" */
    it("is written out and reaches the matcher as no context", () => {
      const options: FeatureFlagEvaluateOptions = {
        distinctId: "user-1",
        projectId: "project-1",
        organizationId: undefined,
      };

      expect(toRuleContextId(options.organizationId)).toBeUndefined();
    });
  });

  describe("given a flag that is off by default with one organization rule", () => {
    /** @scenario "a read that carries the organization matches an organization rule" */
    it("resolves enabled for a read that carries that organization", async () => {
      const service = buildService({
        enabled: false,
        rules: [{ match: { organizationId: "organization-1" }, enabled: true }],
      });

      const enabled = await service.isEnabled(PRODUCT_FLAG, {
        distinctId: "user-1",
        projectId: "project-1",
        organizationId: "organization-1",
      });

      expect(enabled).toBe(true);
    });

    it("resolves disabled for a read that opts the organization out", async () => {
      const service = buildService({
        enabled: false,
        rules: [{ match: { organizationId: "organization-1" }, enabled: true }],
      });

      const enabled = await service.isEnabled(PRODUCT_FLAG, {
        distinctId: "user-1",
        projectId: "project-1",
        organizationId: NOT_TARGETED,
      });

      expect(enabled).toBe(false);
    });
  });
});
