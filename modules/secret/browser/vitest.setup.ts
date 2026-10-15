/**
 * Vitest setup for this package. Registers jest-dom matchers (from platform app migrations)
 * and polyfills browser APIs jsdom lacks (ResizeObserver, etc.) that Chakra overlays need for
 * positioning. Shared pattern across feature-web packages.
 */

import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

// Auto-cleanup only registers itself when a global afterEach exists at import
// time; this package runs without vitest globals, so an explicit hook is what
// keeps one test's rendered tree out of the next test's queries.
afterEach(() => cleanup());

if (typeof window !== "undefined") {
  if (!window.matchMedia) {
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      writable: true,
      value: (query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
        addListener: () => undefined,
        removeListener: () => undefined,
        dispatchEvent: () => false,
      }),
    });
  }
  // Ark's select scrolls its highlighted row into view when the list opens.
  // jsdom implements neither `Element.scrollTo` nor `scrollIntoView`, and the
  // first surfaces as "scrollTo is not a function" thrown from inside the
  // library rather than as an assertion failure.
  if (!Element.prototype.scrollTo) {
    Element.prototype.scrollTo = () => undefined;
  }
  if (!Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = () => undefined;
  }
  if (!window.ResizeObserver) {
    Object.defineProperty(window, "ResizeObserver", {
      configurable: true,
      writable: true,
      value: class {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    });
  }
}
