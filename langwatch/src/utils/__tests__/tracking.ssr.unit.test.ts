/**
 * @vitest-environment node
 *
 * Covers the SSR guards: this module is imported by both client-side React
 * components and code that may evaluate without a `window` global. Run in a
 * plain node environment (no jsdom) so `typeof window === "undefined"` is
 * actually true, unlike every other tracking test in this directory.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { trackEvent, trackEventOnce } from "../tracking";

describe("tracking - without a window global", () => {
  it("trackEvent does not throw", () => {
    expect(() => trackEvent("workflow_create", {})).not.toThrow();
  });

  it("trackEventOnce does not throw", () => {
    expect(() => trackEventOnce("organization_initialized", {})).not.toThrow();
  });
});

describe("tracking - when the window global disappears mid-poll", () => {
  afterEach(() => {
    delete (globalThis as any).window;
    vi.useRealTimers();
    vi.resetModules();
  });

  it("does not throw a ReferenceError out of the poll timer", async () => {
    vi.useFakeTimers();
    vi.resetModules();

    // A window with no gtag on it is all trackEvent needs to start polling.
    (globalThis as any).window = {};
    const { trackEvent } = await import("../tracking");
    trackEvent("workflow_create", { project_id: "p1" });

    // Take the environment away underneath the running poll. Only a node
    // environment can do this: it leaves `window` an undefined free variable,
    // the way a torn-down page does, rather than an object reading undefined.
    delete (globalThis as any).window;

    await expect(vi.advanceTimersByTimeAsync(1000)).resolves.not.toThrow();
  });
});
