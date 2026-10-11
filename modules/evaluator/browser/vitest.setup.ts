/**
 * Standard test setup for governed web packages. Registers @testing-library/jest-dom DOM
 * matchers and browser APIs that jsdom doesn't ship, needed for Chakra overlays. Prevents
 * ResizeObserver from failing silently in animation frames.
 */

import "@testing-library/jest-dom/vitest";
import {
  installTestColourVariables,
  type TestColourVariables,
} from "@langwatch/design-system/testing";
import { cleanup } from "@testing-library/react";
import { afterEach, beforeEach } from "vitest";

let colours: TestColourVariables | undefined;

// jsdom ignores the provider's layered token CSS, so a raw-colour reader needs the
// variables installed for each test and removed after the tree unmounts.
beforeEach(() => {
  colours = installTestColourVariables();
});

// Auto-cleanup only registers itself when a global afterEach exists at import
// time; this package runs without vitest globals, so an explicit hook is what
// keeps one test's rendered tree out of the next test's queries.
afterEach(() => {
  cleanup();
  colours?.dispose();
  colours = void 0;
});

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
