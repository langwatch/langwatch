/**
 * @vitest-environment node
 *
 * How a session's email travels through the service: a read made on behalf
 * of a signed-in user hands the store that user's email, so an email domain
 * rule can compare against it, and a read with no email leaves the store
 * with none, so no domain rule can match it.
 *
 * @see specs/ops/internal-feature-flags.feature
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

describe("a flag read on behalf of a session", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  describe("given the read carries the session user's email", () => {
    describe("when it is resolved through the service", () => {
      /** @scenario "the session's email reaches the store on a flag read" */
      it("hands the store that email next to the distinct id", async () => {
        vi.stubEnv("FEATURE_FLAG_FORCE_ENABLE", "");
        const store = { get: vi.fn().mockResolvedValue(true) };

        const enabled = await serviceWith(store).isEnabled(FLAG, {
          distinctId: "user_1",
          userEmail: "qa@acme.com",
          projectId: NOT_TARGETED,
          organizationId: NOT_TARGETED,
        });

        expect(enabled).toBe(true);
        expect(store.get).toHaveBeenCalledWith(
          FLAG,
          expect.objectContaining({
            distinctId: "user_1",
            userEmail: "qa@acme.com",
          }),
        );
      });
    });
  });

  describe("given the read carries no email, or a null one from a session without it", () => {
    describe("when it is resolved through the service", () => {
      it("hands the store no email, so no domain rule can match", async () => {
        vi.stubEnv("FEATURE_FLAG_FORCE_ENABLE", "");
        const store = { get: vi.fn().mockResolvedValue(null) };
        const service = serviceWith(store);

        await service.isEnabled(FLAG, {
          distinctId: "job",
          projectId: NOT_TARGETED,
          organizationId: "organization_1",
        });
        await service.isEnabled(FLAG, {
          distinctId: "user_2",
          userEmail: null,
          projectId: NOT_TARGETED,
          organizationId: "organization_1",
        });

        for (const call of store.get.mock.calls) {
          expect((call[1] as { userEmail?: string }).userEmail).toBeUndefined();
        }
      });
    });
  });
});
