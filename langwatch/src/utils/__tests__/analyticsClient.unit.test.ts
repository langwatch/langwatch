/**
 * @vitest-environment jsdom
 *
 * react-contextual-analytics' createAnalyticsClient no-ops (empty providers)
 * without a `window` global, so this needs a browser-like environment.
 */
import type { PostHog } from "posthog-js";
import type { Provider } from "react-contextual-analytics";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createAppAnalyticsClient } from "../analyticsClient";

type ProviderEvent = Parameters<Provider["send"]>[0];

function fakePostHog(overrides: Partial<PostHog> = {}): PostHog {
  return overrides as PostHog;
}

function fakeEvent(overrides: Partial<ProviderEvent> = {}): ProviderEvent {
  return { version: "2025-05-29", action: "click", ...overrides };
}

describe("createAppAnalyticsClient", () => {
  const originalNodeEnv = process.env.NODE_ENV;

  beforeEach(() => {
    process.env.NODE_ENV = "production";
  });

  afterEach(() => {
    process.env.NODE_ENV = originalNodeEnv;
  });

  describe("given isSaaS is false", () => {
    it("registers neither the google nor posthog provider", () => {
      const client = createAppAnalyticsClient({
        isSaaS: false,
        posthogClient: fakePostHog({ capture: vi.fn() as PostHog["capture"] }),
        isGtagReady: true,
      });

      expect(client.providers.map((p) => p.id)).not.toContain("google");
      expect(client.providers.map((p) => p.id)).not.toContain("posthog");
    });
  });

  describe("given isSaaS is true and isGtagReady is true", () => {
    it("registers the google provider", () => {
      const client = createAppAnalyticsClient({
        isSaaS: true,
        posthogClient: undefined,
        isGtagReady: true,
      });

      expect(client.providers.map((p) => p.id)).toContain("google");
    });
  });

  describe("given isSaaS is true and isGtagReady is false", () => {
    it("does not register the google provider", () => {
      const client = createAppAnalyticsClient({
        isSaaS: true,
        posthogClient: undefined,
        isGtagReady: false,
      });

      expect(client.providers.map((p) => p.id)).not.toContain("google");
    });
  });

  describe("given isSaaS is true and a posthogClient is provided", () => {
    it("registers a posthog provider that forwards events via capture", async () => {
      const capture = vi.fn();
      const client = createAppAnalyticsClient({
        isSaaS: true,
        posthogClient: fakePostHog({ capture: capture as PostHog["capture"] }),
        isGtagReady: false,
      });

      const posthogProvider = client.providers.find((p) => p.id === "posthog")!;
      await posthogProvider.send(
        fakeEvent({
          boundary: "workflow",
          action: "create",
          name: "click",
          attributes: { project_id: "p1" },
          context: {},
        }),
      );

      expect(capture).toHaveBeenCalledWith("workflow.create.click", {
        project_id: "p1",
        boundary: "workflow",
        context: {},
      });
    });

    describe("when posthogClient.capture is unavailable", () => {
      it("does not throw", async () => {
        const client = createAppAnalyticsClient({
          isSaaS: true,
          posthogClient: fakePostHog(),
          isGtagReady: false,
        });

        const posthogProvider = client.providers.find(
          (p) => p.id === "posthog",
        )!;

        await expect(
          posthogProvider.send(
            fakeEvent({
              boundary: "workflow",
              action: "create",
              name: "click",
              attributes: {},
              context: {},
            }),
          ),
        ).resolves.not.toThrow();
      });
    });
  });

  describe("given isSaaS is true and no posthogClient is provided", () => {
    it("does not register a posthog provider", () => {
      const client = createAppAnalyticsClient({
        isSaaS: true,
        posthogClient: undefined,
        isGtagReady: false,
      });

      expect(client.providers.map((p) => p.id)).not.toContain("posthog");
    });
  });

  describe("given NODE_ENV is not production", () => {
    it("registers the console provider", () => {
      process.env.NODE_ENV = "development";
      const client = createAppAnalyticsClient({
        isSaaS: false,
        posthogClient: undefined,
        isGtagReady: false,
      });

      expect(client.providers.map((p) => p.id)).toContain("console");
    });
  });

  describe("given NODE_ENV is production", () => {
    it("does not register the console provider", () => {
      const client = createAppAnalyticsClient({
        isSaaS: false,
        posthogClient: undefined,
        isGtagReady: false,
      });

      expect(client.providers.map((p) => p.id)).not.toContain("console");
    });
  });
});
