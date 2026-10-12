/**
 * What every suite in this package gets before it runs, and the unmount after.
 */
import "@testing-library/jest-dom/vitest";
import {
  installTestColourVariables,
  type TestColourVariables,
} from "@langwatch/design-system/testing";
import { cleanup } from "@testing-library/react";
import { afterEach, beforeEach } from "vitest";

let colours: TestColourVariables | undefined;

beforeEach(() => {
  colours = installTestColourVariables();
});

afterEach(() => {
  cleanup();
  colours?.dispose();
  colours = void 0;
});

class ResizeObserverStub implements ResizeObserver {
  constructor(_callback: ResizeObserverCallback) {}

  disconnect(): void {}

  observe(_target: Element): void {}

  unobserve(_target: Element): void {}
}

globalThis.ResizeObserver = ResizeObserverStub;

if (!Element.prototype.scrollTo) {
  Element.prototype.scrollTo = function scrollTo(): void {};
}
