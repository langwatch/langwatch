/**
 * Stubs matchMedia (the colour-mode provider reads it) and ResizeObserver (a drawer's chrome
 * watches its bands with one); jsdom ships neither.
 */

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

class ResizeObserverStub implements ResizeObserver {
  constructor(_callback: ResizeObserverCallback) {}

  disconnect(): void {}

  observe(_target: Element): void {}

  unobserve(_target: Element): void {}
}

if (typeof window !== "undefined" && !window.ResizeObserver) {
  globalThis.ResizeObserver = ResizeObserverStub;
}
