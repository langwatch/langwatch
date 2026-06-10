import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { FeatureFlagService } from "../featureFlag.service";
import type { FeatureFlagStorePostgres } from "../featureFlagStore.postgres";
import type { FeatureFlagServiceInterface } from "../types";

vi.mock("../featureFlagService.posthog", () => ({
  FeatureFlagServicePostHog: {
    create: () => ({
      isEnabled: vi.fn().mockResolvedValue(false),
    }),
  },
}));

vi.mock("../featureFlagService.memory", () => ({
  FeatureFlagServiceMemory: {
    create: () => ({
      isEnabled: vi.fn().mockResolvedValue(false),
    }),
  },
}));

// Store stub. Registry-aware paths are exercised in the resolver
// suite; here we just need an inert dependency so the constructor
// doesn't reach into the real Prisma client.
function buildNoopStore(): FeatureFlagStorePostgres {
  return {
    get: vi.fn().mockResolvedValue(null),
    set: vi.fn().mockResolvedValue(undefined),
    clear: vi.fn().mockResolvedValue(undefined),
    listAll: vi.fn().mockResolvedValue([]),
  } as unknown as FeatureFlagStorePostgres;
}

function buildLegacy(returnValue: boolean): FeatureFlagServiceInterface {
  return { isEnabled: vi.fn().mockResolvedValue(returnValue) };
}

describe("FeatureFlagService", () => {
  describe("isEnabled()", () => {
    describe("when no env override is set", () => {
      const originalEnvValue = process.env.RELEASE_UI_SIMULATIONS_MENU_ENABLED;

      beforeEach(() => {
        delete process.env.RELEASE_UI_SIMULATIONS_MENU_ENABLED;
      });

      afterEach(() => {
        if (originalEnvValue === undefined) {
          delete process.env.RELEASE_UI_SIMULATIONS_MENU_ENABLED;
        } else {
          process.env.RELEASE_UI_SIMULATIONS_MENU_ENABLED = originalEnvValue;
        }
      });

      it("delegates unregistered flags to the legacy service", async () => {
        const legacy = buildLegacy(true);
        const service = new FeatureFlagService({
          legacy,
          store: buildNoopStore(),
        });

        const result = await service.isEnabled("some-flag" as never, {
          distinctId: "user-1",
          defaultValue: false,
        });

        expect(result).toBe(true);
        expect(legacy.isEnabled).toHaveBeenCalledWith("some-flag", {
          distinctId: "user-1",
          defaultValue: false,
        });
      });

      it("forwards projectId to the legacy service", async () => {
        const legacy = buildLegacy(true);
        const service = new FeatureFlagService({
          legacy,
          store: buildNoopStore(),
        });

        await service.isEnabled("some-flag" as never, {
          distinctId: "user-1",
          defaultValue: true,
          projectId: "proj-123",
        });

        expect(legacy.isEnabled).toHaveBeenCalledWith("some-flag", {
          distinctId: "user-1",
          defaultValue: true,
          projectId: "proj-123",
        });
      });

      it("forwards organizationId to the legacy service", async () => {
        const legacy = buildLegacy(true);
        const service = new FeatureFlagService({
          legacy,
          store: buildNoopStore(),
        });

        await service.isEnabled("some-flag" as never, {
          distinctId: "user-1",
          defaultValue: false,
          organizationId: "org-456",
        });

        expect(legacy.isEnabled).toHaveBeenCalledWith("some-flag", {
          distinctId: "user-1",
          defaultValue: false,
          organizationId: "org-456",
        });
      });
    });

    describe("when env override is set", () => {
      const originalEnv = process.env;

      beforeEach(() => {
        process.env = { ...originalEnv };
      });

      afterEach(() => {
        process.env = originalEnv;
      });

      describe("when env var is 1", () => {
        it("returns true regardless of default", async () => {
          process.env.RELEASE_UI_SIMULATIONS_MENU_ENABLED = "1";
          const service = FeatureFlagService.create();

          const result = await service.isEnabled(
            "release_ui_simulations_menu_enabled" as never,
            { distinctId: "user-123", defaultValue: false },
          );

          expect(result).toBe(true);
        });
      });

      describe("when env var is 0", () => {
        it("returns false regardless of default", async () => {
          process.env.RELEASE_UI_SIMULATIONS_MENU_ENABLED = "0";
          const service = FeatureFlagService.create();

          const result = await service.isEnabled(
            "release_ui_simulations_menu_enabled" as never,
            { distinctId: "user-123", defaultValue: true },
          );

          expect(result).toBe(false);
        });
      });
    });

    describe("when FEATURE_FLAG_FORCE_ENABLE is set", () => {
      const originalEnv = process.env;

      beforeEach(() => {
        process.env = { ...originalEnv };
      });

      afterEach(() => {
        process.env = originalEnv;
      });

      it("forces matching flag on regardless of legacy service", async () => {
        process.env.FEATURE_FLAG_FORCE_ENABLE = "some_flag,other_flag";
        const legacy = buildLegacy(false);
        const service = new FeatureFlagService({
          legacy,
          store: buildNoopStore(),
        });

        const result = await service.isEnabled("some_flag" as never, {
          distinctId: "user-1",
          defaultValue: false,
        });

        expect(result).toBe(true);
        expect(legacy.isEnabled).not.toHaveBeenCalled();
      });

      it("does not force flags outside the list", async () => {
        process.env.FEATURE_FLAG_FORCE_ENABLE = "only_this_flag";
        const legacy = buildLegacy(false);
        const service = new FeatureFlagService({
          legacy,
          store: buildNoopStore(),
        });

        const result = await service.isEnabled("different_flag" as never, {
          distinctId: "u",
          defaultValue: false,
        });

        expect(result).toBe(false);
        expect(legacy.isEnabled).toHaveBeenCalled();
      });

      it("trims whitespace in the comma-separated list", async () => {
        process.env.FEATURE_FLAG_FORCE_ENABLE = "  spaced_flag  , other ";
        const legacy = buildLegacy(false);
        const service = new FeatureFlagService({
          legacy,
          store: buildNoopStore(),
        });

        const result = await service.isEnabled("spaced_flag" as never, {
          distinctId: "u",
          defaultValue: false,
        });

        expect(result).toBe(true);
      });

      it("runs at the top level so the legacy service is bypassed", async () => {
        process.env.FEATURE_FLAG_FORCE_ENABLE = "release_ui_ai_gateway_menu_enabled";
        delete process.env.POSTHOG_KEY;
        const legacy = buildLegacy(false);
        const service = new FeatureFlagService({
          legacy,
          store: buildNoopStore(),
        });

        const result = await service.isEnabled(
          "release_ui_ai_gateway_menu_enabled",
          { distinctId: "u", defaultValue: false },
        );

        expect(result).toBe(true);
        expect(legacy.isEnabled).not.toHaveBeenCalled();
      });

      it("per-flag envOverride takes precedence over FEATURE_FLAG_FORCE_ENABLE", async () => {
        process.env.RELEASE_UI_SIMULATIONS_MENU_ENABLED = "0";
        process.env.FEATURE_FLAG_FORCE_ENABLE = "release_ui_simulations_menu_enabled";
        const service = FeatureFlagService.create();

        const result = await service.isEnabled(
          "release_ui_simulations_menu_enabled" as never,
          { distinctId: "u", defaultValue: true },
        );

        expect(result).toBe(false);
      });
    });
  });
});
