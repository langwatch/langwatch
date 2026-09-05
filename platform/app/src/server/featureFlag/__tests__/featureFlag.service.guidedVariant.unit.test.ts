/**
 * @vitest-environment node
 *
 * How the guided onboarding flag resolves through the service: the caller's
 * distinct id reaches the store so a percentage rollout can bucket on it, the
 * classic variant is what an unconfigured deployment reads, and the dev
 * force-enable wins before any rule is consulted.
 *
 * @see specs/features/onboarding/guided-onboarding-variant.feature
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { FeatureFlagService } from "../featureFlag.service";
import type { FeatureFlagStorePostgres } from "../featureFlagStore.postgres";
import { NOT_TARGETED } from "../targeting";
import type { FeatureFlagServiceInterface } from "../types";

const FLAG = "experiment_onboarding_langy_guided";

function serviceWith(store: { get: ReturnType<typeof vi.fn> }) {
  const legacy: FeatureFlagServiceInterface = {
    isEnabled: vi.fn().mockResolvedValue(false),
  };
  return new FeatureFlagService({
    legacy,
    store: store as unknown as FeatureFlagStorePostgres,
  });
}

describe("the guided onboarding flag", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  describe("given the flag has a percentage rollout rule in the store", () => {
    describe("when it is read through the service for a user", () => {
      /** @scenario "the flag reaches the store with the caller's distinct id" */
      it("hands the store that user's distinct id", async () => {
        vi.stubEnv("FEATURE_FLAG_FORCE_ENABLE", "");
        const store = { get: vi.fn().mockResolvedValue(true) };

        const enabled = await serviceWith(store).isEnabled(FLAG, {
          distinctId: "user_1",
          projectId: NOT_TARGETED,
          organizationId: "organization_1",
        });

        expect(enabled).toBe(true);
        expect(store.get).toHaveBeenCalledWith(
          FLAG,
          expect.objectContaining({
            distinctId: "user_1",
            organizationId: "organization_1",
          }),
        );
      });
    });
  });

  describe("given no rule and no operator row", () => {
    describe("when the flag is read for any user", () => {
      /** @scenario "the classic variant is unchanged when the flag is off" */
      it("resolves to false, the registry default", async () => {
        vi.stubEnv("FEATURE_FLAG_FORCE_ENABLE", "");
        const store = { get: vi.fn().mockResolvedValue(null) };

        const enabled = await serviceWith(store).isEnabled(FLAG, {
          distinctId: "user_1",
          projectId: NOT_TARGETED,
          organizationId: NOT_TARGETED,
        });

        expect(enabled).toBe(false);
      });
    });
  });

  describe("given FEATURE_FLAG_FORCE_ENABLE names the flag", () => {
    describe("when the flag is read for any user", () => {
      /** @scenario "the force-enable environment variable turns the guided variant on for everyone" */
      it("resolves to true before the store is consulted", async () => {
        vi.stubEnv("FEATURE_FLAG_FORCE_ENABLE", `release_langy_enabled,${FLAG}`);
        const store = { get: vi.fn().mockResolvedValue(false) };

        const enabled = await serviceWith(store).isEnabled(FLAG, {
          distinctId: "user_1",
          projectId: NOT_TARGETED,
          organizationId: NOT_TARGETED,
        });

        expect(enabled).toBe(true);
        expect(store.get).not.toHaveBeenCalled();
      });
    });
  });
});
