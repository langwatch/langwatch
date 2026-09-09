/**
 * What every test in this package needs before it renders anything.
 *
 * The same shape `@langwatch/gateway-web`, `@langwatch/github-web` and the rest
 * of the governed web packages state for themselves.
 * `@testing-library/jest-dom` registers the DOM matchers the suites moved from
 * `platform/app` were written against, and the rest are browser APIs jsdom does
 * not ship and Chakra's overlays reach for on the way to positioning
 * themselves. A missing `ResizeObserver` surfaces as an unhandled rejection out
 * of an animation frame rather than as a failure, so a shard fails with its own
 * summary all green.
 */

import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

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
  // Ark's menus and selects scroll a highlighted row into view when they open.
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
