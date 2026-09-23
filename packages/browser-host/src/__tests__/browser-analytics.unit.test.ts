/**
 * The destination names are a wire: a rename here breaks a dashboard and
 * nothing else, so every string below is pinned against what
 * react-contextual-analytics sent before it was evicted.
 * @vitest-environment jsdom
 */
import type { PostHog } from "posthog-js";
import { describe, expect, it, vi } from "vitest";

import { createBrowserUiAnalytics } from "../browser-analytics.ts";

function fakePostHog(overrides: Partial<PostHog> = {}): PostHog {
  return overrides as PostHog;
}

function saasWithPostHog(capture: PostHog["capture"]) {
  return createBrowserUiAnalytics({
    isSaaS: true,
    posthogClient: fakePostHog({ capture }),
    isGtagReady: false,
    isDevelopment: false,
  });
}

describe("the browser analytics destinations", () => {
  describe("given a SaaS deployment with PostHog registered", () => {
    it("is boundary.action.name", () => {
      const capture = vi.fn();
      saasWithPostHog(capture as PostHog["capture"]).track({
        boundary: "workflow",
        action: "create",
        name: "click",
      });

      expect(capture.mock.calls[0]?.[0]).toBe("workflow.create.click");
    });

    it("drops the boundary when the event names none", () => {
      const capture = vi.fn();
      saasWithPostHog(capture as PostHog["capture"]).track({
        action: "created",
        name: "project",
      });

      expect(capture.mock.calls[0]?.[0]).toBe("created.project");
    });

    it("drops the name when the boundary is the noun", () => {
      const capture = vi.fn();
      saasWithPostHog(capture as PostHog["capture"]).track({
        boundary: "onboarding_welcome.intent",
        action: "viewed",
      });

      expect(capture.mock.calls[0]?.[0]).toBe("onboarding_welcome.intent.viewed");
    });
  });

  describe("and the event carries its own attributes", () => {
    it("are the event's own attributes plus the boundary and the page context", () => {
      const capture = vi.fn();
      saasWithPostHog(capture as PostHog["capture"]).track({
        boundary: "workflow",
        action: "create",
        name: "click",
        attributes: { project_id: "p1" },
      });

      expect(capture.mock.calls[0]?.[1]).toEqual({
        project_id: "p1",
        boundary: "workflow",
        context: {
          href: window.location.href,
          windowWidth: window.innerWidth,
          windowHeight: window.innerHeight,
          userAgent: window.navigator.userAgent,
        },
      });
    });

    it("does not throw when the PostHog client cannot capture", () => {
      const analytics = createBrowserUiAnalytics({
        isSaaS: true,
        posthogClient: fakePostHog(),
        isGtagReady: false,
        isDevelopment: false,
      });

      expect(() => analytics.track({ action: "create", name: "click" })).not.toThrow();
    });
  });

  describe("given a self-hosted deployment", () => {
    it("sends to neither Google nor PostHog", () => {
      const capture = vi.fn();
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

      createBrowserUiAnalytics({
        isSaaS: false,
        posthogClient: fakePostHog({ capture: capture as PostHog["capture"] }),
        isGtagReady: true,
        isDevelopment: false,
      }).track({ action: "created", name: "project" });

      expect(capture).not.toHaveBeenCalled();
      expect(warn).not.toHaveBeenCalled();
      warn.mockRestore();
    });
  });

  describe("given SaaS with gtag ready", () => {
    it("reaches the Google destination, which reports the global it wants is absent", () => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

      createBrowserUiAnalytics({
        isSaaS: true,
        posthogClient: undefined,
        isGtagReady: true,
        isDevelopment: false,
      }).track({ action: "created", name: "project" });

      expect(warn).toHaveBeenCalledWith("gtag is not available");
      warn.mockRestore();
    });
  });

  describe("given a development build", () => {
    it("prints every event", () => {
      const dir = vi.spyOn(console, "dir").mockImplementation(() => {});

      createBrowserUiAnalytics({
        isSaaS: false,
        posthogClient: undefined,
        isGtagReady: false,
        isDevelopment: true,
      }).track({ action: "created", name: "project" });

      expect(dir).toHaveBeenCalledWith(
        expect.objectContaining({ version: "2025-05-29", action: "created", name: "project" }),
        { depth: null },
      );
      dir.mockRestore();
    });

    it("does not print in a production build", () => {
      const dir = vi.spyOn(console, "dir").mockImplementation(() => {});

      createBrowserUiAnalytics({
        isSaaS: false,
        posthogClient: undefined,
        isGtagReady: false,
        isDevelopment: false,
      }).track({ action: "created", name: "project" });

      expect(dir).not.toHaveBeenCalled();
      dir.mockRestore();
    });
  });

  describe("when one destination throws", () => {
    it("still reaches the others", () => {
      const error = vi.spyOn(console, "error").mockImplementation(() => {});
      const dir = vi.spyOn(console, "dir").mockImplementation(() => {
        throw new Error("console destination failed");
      });
      const capture = vi.fn();

      createBrowserUiAnalytics({
        isSaaS: true,
        posthogClient: fakePostHog({ capture: capture as PostHog["capture"] }),
        isGtagReady: false,
        isDevelopment: true,
      }).track({ action: "created", name: "project" });

      expect(capture).toHaveBeenCalledWith("created.project", expect.anything());
      expect(error).toHaveBeenCalled();
      dir.mockRestore();
      error.mockRestore();
    });
  });
});

describe("who the events are about", () => {
  function saasWithIdentity() {
    const identify = vi.fn();
    const group = vi.fn();
    const reset = vi.fn();
    const analytics = createBrowserUiAnalytics({
      isSaaS: true,
      posthogClient: fakePostHog({
        capture: vi.fn(),
        identify,
        group,
        reset,
      } as Partial<PostHog>),
      isGtagReady: false,
      isDevelopment: false,
    });
    return { analytics, identify, group, reset };
  }

  it("identifies the reader to PostHog by id, with their address", () => {
    const { analytics, identify } = saasWithIdentity();
    analytics.identify({ id: "user_1", email: "ada@example.com" });
    expect(identify).toHaveBeenCalledWith("user_1", { email: "ada@example.com" });
  });

  it("groups later events under the organization by id and name", () => {
    const { analytics, group } = saasWithIdentity();
    analytics.group({ id: "org_1", name: "Acme" });
    expect(group).toHaveBeenCalledWith("organization", "org_1", { name: "Acme" });
  });

  it("forgets the reader on reset, and a destination without identity is left alone", () => {
    const { analytics, reset } = saasWithIdentity();
    analytics.reset();
    expect(reset).toHaveBeenCalledOnce();
    const consoleOnly = createBrowserUiAnalytics({
      isSaaS: false,
      posthogClient: undefined,
      isGtagReady: false,
      isDevelopment: true,
    });
    expect(() => consoleOnly.identify({ id: "user_1", email: null })).not.toThrow();
  });
});
