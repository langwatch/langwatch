/**
 * The jest-dom matchers, registered once for the package, and a matchMedia
 * stub: the design-system colour-mode provider reads it and jsdom lacks it.
 */
import "@testing-library/jest-dom/vitest";

if (typeof window !== "undefined" && !window.matchMedia) {
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
