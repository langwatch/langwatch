/**
 * What every test in this package needs before it renders anything.
 *
 * Two things, and neither belongs in a test file. `@testing-library/jest-dom`
 * registers the DOM matchers the suites moved from `platform/app` were written
 * against — `toHaveTextContent`, `toHaveAttribute`, `toBeChecked` — which that
 * application registered in its own global setup, so the assertions travel
 * unchanged rather than being rewritten into `.textContent` comparisons.
 *
 * The other two are browser APIs jsdom does not ship and Chakra's overlays
 * reach for on the way to positioning themselves. A missing `ResizeObserver`
 * surfaces as an unhandled rejection out of an animation frame rather than as a
 * failure, so a shard fails with its own summary all green.
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
  if (!window.ResizeObserver) {
    Object.defineProperty(window, "ResizeObserver", {
      configurable: true,
      // Writable as well as configurable: a suite that wants an observer of its
      // own assigns `globalThis.ResizeObserver` directly, and a value-only
      // definition makes that assignment throw rather than take.
      writable: true,
      value: class {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    });
  }
  // jsdom implements no scrolling at all, and the virtualised turn list pins
  // itself to the tail on mount. Without this every suite that renders a
  // conversation fails inside an effect rather than on an assertion.
  if (!Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = function scrollIntoView() {
      // Nothing to scroll in jsdom.
    };
  }
}
