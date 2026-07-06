/**
 * @vitest-environment jsdom
 *
 * react-contextual-analytics' createAnalyticsClient no-ops (empty providers)
 * without a `window` global, so this needs a browser-like environment.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createAppAnalyticsClient } from "../analyticsClient";

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
        posthogClient: { capture: vi.fn() } as any,
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
        posthogClient: { capture } as any,
        isGtagReady: false,
      });

      const posthogProvider = client.providers.find((p) => p.id === "posthog")!;
      await posthogProvider.send({
        boundary: "workflow",
        action: "create",
        name: "click",
        attributes: { project_id: "p1" },
        context: {},
      } as any);

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
          posthogClient: {} as any,
          isGtagReady: false,
        });

        const posthogProvider = client.providers.find(
          (p) => p.id === "posthog",
        )!;

        await expect(
          posthogProvider.send({
            boundary: "workflow",
            action: "create",
            name: "click",
            attributes: {},
            context: {},
          } as any),
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
