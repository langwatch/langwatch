/**
 * @vitest-environment jsdom
 *
 * react-contextual-analytics' createAnalyticsClient no-ops (empty providers)
 * without a `window` global, so this needs a browser-like environment.
 */
import type { PostHog } from "posthog-js";
import type { Provider } from "react-contextual-analytics";
import { describe, expect, it, vi } from "vitest";

import { createUiAnalyticsClient } from "../src/behavior/analytics-client";

type ProviderEvent = Parameters<Provider["send"]>[0];

function fakePostHog(overrides: Partial<PostHog> = {}): PostHog {
  return overrides as PostHog;
}

function fakeEvent(overrides: Partial<ProviderEvent> = {}): ProviderEvent {
  return { version: "2025-05-29", action: "click", ...overrides };
}

describe("createUiAnalyticsClient", () => {
  describe("given isSaaS is false", () => {
    it("registers neither the google nor posthog provider", () => {
      const client = createUiAnalyticsClient({
        isSaaS: false,
        posthogClient: fakePostHog({ capture: vi.fn() as PostHog["capture"] }),
        isGtagReady: true,
        isDevelopment: false,
      });

      expect(client.providers.map((p) => p.id)).not.toContain("google");
      expect(client.providers.map((p) => p.id)).not.toContain("posthog");
    });
  });

  describe("given isSaaS is true and isGtagReady is true", () => {
    it("registers the google provider", () => {
      const client = createUiAnalyticsClient({
        isSaaS: true,
        posthogClient: undefined,
        isGtagReady: true,
        isDevelopment: false,
      });

      expect(client.providers.map((p) => p.id)).toContain("google");
    });
  });

  describe("given isSaaS is true and isGtagReady is false", () => {
    it("does not register the google provider", () => {
      const client = createUiAnalyticsClient({
        isSaaS: true,
        posthogClient: undefined,
        isGtagReady: false,
        isDevelopment: false,
      });

      expect(client.providers.map((p) => p.id)).not.toContain("google");
    });
  });

  describe("given isSaaS is true and a posthogClient is provided", () => {
    it("registers a posthog provider that forwards events via capture", async () => {
      const capture = vi.fn();
      const client = createUiAnalyticsClient({
        isSaaS: true,
        posthogClient: fakePostHog({ capture: capture as PostHog["capture"] }),
        isGtagReady: false,
        isDevelopment: false,
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
        const client = createUiAnalyticsClient({
          isSaaS: true,
          posthogClient: fakePostHog(),
          isGtagReady: false,
          isDevelopment: false,
        });

        const posthogProvider = client.providers.find((p) => p.id === "posthog")!;

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
      const client = createUiAnalyticsClient({
        isSaaS: true,
        posthogClient: undefined,
        isGtagReady: false,
        isDevelopment: false,
      });

      expect(client.providers.map((p) => p.id)).not.toContain("posthog");
    });
  });

  describe("given a development build", () => {
    it("registers the console provider", () => {
      const client = createUiAnalyticsClient({
        isSaaS: false,
        posthogClient: undefined,
        isGtagReady: false,
        isDevelopment: true,
      });

      expect(client.providers.map((p) => p.id)).toContain("console");
    });
  });

  describe("given a production build", () => {
    it("does not register the console provider", () => {
      const client = createUiAnalyticsClient({
        isSaaS: false,
        posthogClient: undefined,
        isGtagReady: false,
        isDevelopment: false,
      });

      expect(client.providers.map((p) => p.id)).not.toContain("console");
    });
  });
});
