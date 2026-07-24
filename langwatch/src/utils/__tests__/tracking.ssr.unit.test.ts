/**
 * @vitest-environment node
 *
 * Covers the SSR guards: this module is imported by both client-side React
 * components and code that may evaluate without a `window` global. Run in a
 * plain node environment (no jsdom) so `typeof window === "undefined"` is
 * actually true, unlike every other tracking test in this directory.
 */
import { describe, expect, it } from "vitest";

import { trackEvent, trackEventOnce } from "../tracking";

describe("tracking - without a window global", () => {
  it("trackEvent does not throw", () => {
    expect(() => trackEvent("workflow_create", {})).not.toThrow();
  });

  it("trackEventOnce does not throw", () => {
    expect(() => trackEventOnce("organization_initialized", {})).not.toThrow();
  });
});
