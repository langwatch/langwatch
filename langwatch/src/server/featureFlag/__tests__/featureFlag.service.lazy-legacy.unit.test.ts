/**
 * @vitest-environment node
 *
 * The legacy backend (PostHog when configured) is built lazily, on the first
 * PRODUCT/unregistered flag evaluation. Constructing the PostHog backend calls
 * getPostHogInstance(), which starts posthog-node's background flag-definition
 * poller. A process that only ever reads SYSTEM flags (the workers and the
 * event-sourcing pipeline — those resolve from postgres and never touch
 * PostHog) must therefore never construct it, so it never polls PostHog and
 * never trips the feature-flags billing quota.
 *
 * @see specs/analytics/posthog-cost-control.feature
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FeatureFlagService } from "../featureFlag.service";
import type { FeatureFlagStorePostgres } from "../featureFlagStore.postgres";

const { posthogCreateSpy, memoryCreateSpy } = vi.hoisted(() => ({
  posthogCreateSpy: vi.fn(),
  memoryCreateSpy: vi.fn(),
}));

vi.mock("~/env.mjs", () => ({
  env: { POSTHOG_KEY: "phc_test_key" },
}));

vi.mock("../featureFlagService.posthog", () => ({
  FeatureFlagServicePostHog: {
    create: () => {
      posthogCreateSpy();
      return { isEnabled: vi.fn().mockResolvedValue(false), isAvailable: () => true };
    },
  },
}));

vi.mock("../featureFlagService.memory", () => ({
  FeatureFlagServiceMemory: {
    create: () => {
      memoryCreateSpy();
      return { isEnabled: vi.fn().mockResolvedValue(false), isAvailable: () => true };
    },
  },
}));

vi.mock("~/utils/logger/server", () => ({
  createLogger: () => ({
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  }),
}));

const SYSTEM_FLAG = "ops_es_causality_loop_guard_disabled";
const PRODUCT_FLAG = "release_ui_ai_gateway_menu_enabled";

const emptyStore = {
  get: vi.fn().mockResolvedValue(null),
} as unknown as FeatureFlagStorePostgres;

function buildService() {
  // No `legacy` injected: exercises the real lazy createLegacyService path.
  return new FeatureFlagService({ store: emptyStore });
}

describe("FeatureFlagService legacy backend construction", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.clearAllMocks();
    // The dev .env force-enables this PRODUCT flag, which would short-circuit
    // before the legacy path. Clear the overrides so the resolver actually
    // reaches the lazily-built legacy backend.
    process.env = { ...originalEnv };
    delete process.env.RELEASE_NLP_GO_ENGINE_ENABLED;
    delete process.env.FEATURE_FLAG_FORCE_ENABLE;
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe("given a process that only evaluates SYSTEM flags", () => {
    describe("when a SYSTEM flag is evaluated", () => {
      /** @scenario Processes that only read SYSTEM flags never start the local-evaluation poller */
      it("never constructs the PostHog legacy backend, so no poller starts", async () => {
        const service = buildService();

        await service.isEnabled(SYSTEM_FLAG, {
          distinctId: "tenant-a",
          defaultValue: false,
        });

        expect(posthogCreateSpy).not.toHaveBeenCalled();
        expect(memoryCreateSpy).not.toHaveBeenCalled();
      });
    });

    describe("when constructing the service alone", () => {
      it("does not eagerly construct the legacy backend", () => {
        buildService();

        expect(posthogCreateSpy).not.toHaveBeenCalled();
        expect(memoryCreateSpy).not.toHaveBeenCalled();
      });
    });
  });

  describe("given a PRODUCT flag with no store override", () => {
    describe("when the flag is evaluated", () => {
      /** @scenario A PostHog-backed flag builds the client lazily on first evaluation */
      it("constructs the PostHog legacy backend on demand", async () => {
        const service = buildService();

        await service.isEnabled(PRODUCT_FLAG, {
          distinctId: "user-1",
          defaultValue: false,
        });

        expect(posthogCreateSpy).toHaveBeenCalledTimes(1);
      });

      it("constructs it only once across repeated evaluations", async () => {
        const service = buildService();

        await service.isEnabled(PRODUCT_FLAG, { distinctId: "user-1", defaultValue: false });
        await service.isEnabled(PRODUCT_FLAG, { distinctId: "user-2", defaultValue: false });

        expect(posthogCreateSpy).toHaveBeenCalledTimes(1);
      });
    });
  });
});
