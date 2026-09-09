/**
 * What every test in this package needs before it renders anything.
 *
 * The same shape `@langwatch/gateway-web`, `@langwatch/user-web`,
 * `@langwatch/automation-web`, `@langwatch/agent-web` and
 * `@langwatch/data-retention-web` state for themselves, for the same reasons.
 * `@testing-library/jest-dom` registers the DOM matchers the suites moved from
 * `platform/app` were written against — `toBeInTheDocument`, `toBeDisabled`,
 * `toHaveTextContent` — which that application registered in its own global
 * setup, so the assertions travel unchanged rather than being rewritten into
 * `.textContent` comparisons.
 *
 * The rest are browser APIs jsdom does not ship and Chakra's overlays reach for
 * on the way to positioning themselves. A missing `ResizeObserver` surfaces as
 * an unhandled rejection out of an animation frame rather than as a failure, so
 * a shard fails with its own summary all green.
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
