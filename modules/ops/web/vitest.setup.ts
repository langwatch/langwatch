/**
 * What every test in this package needs before it renders anything.
 *
 * Three things, and none belongs in a test file. `@testing-library/jest-dom`
 * registers the DOM matchers the suites moved from `platform/app` were written
 * against — `toBeInTheDocument`, `toHaveTextContent`, `toHaveAttribute` — which
 * that application registered in its own global setup, so the assertions travel
 * unchanged rather than being rewritten into `.textContent` comparisons.
 *
 * The explicit `cleanup` is the gateway family's lesson, and it is not
 * optional: Testing Library registers its own auto-cleanup only when a global
 * `afterEach` exists at import time, this package runs without vitest globals,
 * and without the hook one test's rendered tree is still in the document when
 * the next one queries it.
 *
 * The last two are browser APIs jsdom does not ship and Chakra's overlays reach
 * for on the way to positioning themselves. A missing `ResizeObserver` surfaces
 * as an unhandled rejection out of an animation frame rather than as a failure,
 * so a shard fails with its own summary all green.
 */

import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

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
      value: class {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    });
  }
}
