/**
 * What every suite in this package gets before it runs.
 *
 * `@testing-library/jest-dom/vitest` arrived with the experiments family: the
 * screens and the workbench components that moved out of `platform/app`
 * assert with `toBeInTheDocument`, which that application registered in its own
 * setup file. Registering it here is what let those suites travel unedited.
 */
import "@testing-library/jest-dom/vitest";

class ResizeObserverStub implements ResizeObserver {
  constructor(_callback: ResizeObserverCallback) {}

  disconnect(): void {}

  observe(_target: Element): void {}

  unobserve(_target: Element): void {}
}

globalThis.ResizeObserver = ResizeObserverStub;
