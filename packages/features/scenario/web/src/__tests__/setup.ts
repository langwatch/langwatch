/**
 * What every test in this package needs before it renders anything.
 *
 * `@testing-library/jest-dom` registers the DOM matchers the suites that moved
 * from `platform/app` were written against, which that application registered
 * in its own global setup.
 *
 * The rest are browser APIs jsdom does not ship and Chakra's overlays reach for
 * on the way to positioning themselves. The Agent Testing surfaces brought a
 * menu, a popover and a period picker with them, and a missing `ResizeObserver`
 * surfaces as an unhandled rejection out of an animation frame rather than as a
 * failure — so a shard can fail with its own summary all green.
 */

import "@testing-library/jest-dom/vitest";

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
  // jsdom implements no scrolling at all, and the message renderer pins itself
  // to the tail on mount.
  if (!Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = function scrollIntoView() {
      // Nothing to scroll in jsdom.
    };
  }
}
