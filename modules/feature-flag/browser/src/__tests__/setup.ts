/**
 * jsdom implements neither of these, and the overlay primitives call both:
 * the select popup measures its anchor, and the dialog scrolls its content.
 */
class ResizeObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

if (!("ResizeObserver" in globalThis)) {
  Object.defineProperty(globalThis, "ResizeObserver", {
    configurable: true,
    value: ResizeObserverStub,
  });
}

if (!Element.prototype.scrollTo) {
  Element.prototype.scrollTo = function scrollTo(): void {};
}
