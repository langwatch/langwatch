/**
 * @vitest-environment node
 *
 * Unit tests for posthog-node initialization with local evaluation.
 *
 * Local evaluation is enabled when POSTHOG_FEATURE_FLAGS_KEY is set.
 * It dramatically reduces feature flag costs because the SDK polls flag
 * definitions in the background and evaluates them in-process instead of
 * hitting the /flags endpoint per call.
 *
 * Constructing the client with local evaluation starts that background poller,
 * so the client is built lazily on first getPostHogInstance() call rather than
 * at module load. A process that only reads SYSTEM flags from postgres (workers,
 * the event-sourcing pipeline) imports this module but never requests the
 * instance, so it never starts the poller and never burns the flags quota.
 *
 * @see specs/analytics/posthog-cost-control.feature
 */
import { describe, expect, it, vi, beforeEach } from "vitest";

const { ctorSpy } = vi.hoisted(() => ({
  ctorSpy: vi.fn(),
}));

vi.mock("posthog-node", () => ({
  PostHog: function (apiKey: string, opts: unknown) {
    ctorSpy(apiKey, opts);
    return {
      capture: vi.fn(),
      isFeatureEnabled: vi.fn(),
      shutdown: vi.fn(),
    };
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

describe("posthog-node initialization", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  const mockLocalEvalEnv = () =>
    vi.doMock("~/env.mjs", () => ({
      env: {
        POSTHOG_KEY: "phc_test_key",
        POSTHOG_HOST: "https://us.i.posthog.com",
        POSTHOG_FEATURE_FLAGS_KEY: "phx_personal_key",
      },
    }));

  describe("when POSTHOG_FEATURE_FLAGS_KEY is set", () => {
    describe("when the module is imported but the instance is never requested", () => {
      it("does not construct the client, so no background flag poller starts", async () => {
        mockLocalEvalEnv();

        await import("../posthog");

        expect(ctorSpy).not.toHaveBeenCalled();
      });
    });

    describe("when the instance is first requested", () => {
      it("enables local evaluation with the configured personal API key", async () => {
        mockLocalEvalEnv();

        const { getPostHogInstance } = await import("../posthog");
        getPostHogInstance();

        expect(ctorSpy).toHaveBeenCalledWith(
          "phc_test_key",
          expect.objectContaining({
            host: "https://us.i.posthog.com",
            personalApiKey: "phx_personal_key",
            featureFlagsPollingInterval: expect.any(Number),
          }),
        );
      });

      it("memoizes the instance so the poller is started only once", async () => {
        mockLocalEvalEnv();

        const { getPostHogInstance } = await import("../posthog");
        const first = getPostHogInstance();
        const second = getPostHogInstance();

        expect(ctorSpy).toHaveBeenCalledTimes(1);
        expect(first).toBe(second);
      });
    });

    it("respects an explicit polling interval override", async () => {
      vi.doMock("~/env.mjs", () => ({
        env: {
          POSTHOG_KEY: "phc_test_key",
          POSTHOG_HOST: "https://us.i.posthog.com",
          POSTHOG_FEATURE_FLAGS_KEY: "phx_personal_key",
          POSTHOG_FEATURE_FLAGS_POLLING_INTERVAL_MS: 60_000,
        },
      }));

      const { getPostHogInstance } = await import("../posthog");
      getPostHogInstance();

      expect(ctorSpy).toHaveBeenCalledWith(
        "phc_test_key",
        expect.objectContaining({
          featureFlagsPollingInterval: 60_000,
        }),
      );
    });
  });

  describe("when POSTHOG_FEATURE_FLAGS_KEY is not set", () => {
    it("does not enable local evaluation", async () => {
      vi.doMock("~/env.mjs", () => ({
        env: {
          POSTHOG_KEY: "phc_test_key",
          POSTHOG_HOST: "https://us.i.posthog.com",
        },
      }));

      const { getPostHogInstance } = await import("../posthog");
      getPostHogInstance();

      expect(ctorSpy).toHaveBeenCalledWith(
        "phc_test_key",
        expect.not.objectContaining({
          personalApiKey: expect.anything(),
          featureFlagsPollingInterval: expect.anything(),
        }),
      );
    });
  });

  describe("when POSTHOG_KEY is not set", () => {
    it("does not construct a PostHog instance", async () => {
      vi.doMock("~/env.mjs", () => ({
        env: {},
      }));

      const { getPostHogInstance } = await import("../posthog");
      const instance = getPostHogInstance();

      expect(ctorSpy).not.toHaveBeenCalled();
      expect(instance).toBeNull();
    });
  });
});
