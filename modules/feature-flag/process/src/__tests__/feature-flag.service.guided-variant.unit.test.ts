/**
 * How the guided onboarding flag resolves through the service: a percentage rollout buckets on
 * the caller's own user id, an unconfigured deployment reads the classic variant, and the
 * force-enable list wins before any rule is consulted.
 * @see specs/features/onboarding/guided-onboarding-variant.feature
 */
import { isWithinRolloutPercentage } from "@langwatch/feature-flag-contract";
import { describe, expect, it } from "vitest";

import {
  createFeatureFlagTestService,
  resolveTestFeatureFlagConfig,
} from "../app/__tests__/feature-flag.fixture.ts";

const FLAG = "experiment_onboarding_langy_guided";

function buildService(source: Readonly<Record<string, string | undefined>> = {}) {
  return createFeatureFlagTestService({ config: resolveTestFeatureFlagConfig(source) });
}

function userTarget(userId: string) {
  return { kind: "organization", userId, organizationId: "organization_1" } as const;
}

describe("the guided onboarding flag", () => {
  describe("given the flag has a percentage rollout rule in the store", () => {
    describe("when it is read through the service for a user", () => {
      /** @scenario "the flag reaches the store with the caller's distinct id" */
      it("buckets on that user's id, the same way on every read", async () => {
        const { service } = buildService();
        await service.setRules({
          key: FLAG,
          rules: [{ match: { percentage: 50 }, enabled: true }],
          lastEditedBy: "operator-1",
        });
        const users = Array.from({ length: 20 }, (_, index) => `user_${index}`);

        const reads = await Promise.all(
          users.map((userId) => service.isEnabled(FLAG, userTarget(userId))),
        );
        const again = await Promise.all(
          users.map((userId) => service.isEnabled(FLAG, userTarget(userId))),
        );

        expect(reads).toEqual(
          users.map((subject) =>
            isWithinRolloutPercentage({ flagKey: FLAG, subject, percentage: 50 }),
          ),
        );
        expect(again).toEqual(reads);
        expect(new Set(reads)).toEqual(new Set([true, false]));
      });
    });
  });

  describe("given no rule and no operator row", () => {
    describe("when the flag is read for any user", () => {
      /** @scenario "the classic variant is unchanged when the flag is off" */
      it("resolves to false, the registry default", async () => {
        const { service } = buildService();

        await expect(service.isEnabled(FLAG, userTarget("user_1"))).resolves.toBe(false);
      });
    });
  });

  describe("given FEATURE_FLAG_FORCE_ENABLE names the flag", () => {
    describe("when the flag is read for any user", () => {
      /** @scenario "the force-enable environment variable turns the guided variant on for everyone" */
      it("resolves to true over a rule that admits nobody", async () => {
        const { service } = buildService({
          FEATURE_FLAG_FORCE_ENABLE: `release_langy_enabled,${FLAG}`,
        });
        await service.setRules({
          key: FLAG,
          rules: [{ match: { percentage: 0 }, enabled: true }],
          lastEditedBy: "operator-1",
        });

        await expect(service.isEnabled(FLAG, userTarget("user_1"))).resolves.toBe(true);
      });
    });
  });
});
