class ResizeObserverStub implements ResizeObserver {
  constructor(_callback: ResizeObserverCallback) {}

  disconnect(): void {}

  observe(_target: Element): void {}

  unobserve(_target: Element): void {}
}

globalThis.ResizeObserver = ResizeObserverStub;
