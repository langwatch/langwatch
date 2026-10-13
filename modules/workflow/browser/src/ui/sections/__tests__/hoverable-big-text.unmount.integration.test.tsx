/**
 * HoverableBigText measures its box on a timer; a measurement left scheduled after the
 * component is gone would land after the test environment is torn down.
 * @vitest-environment jsdom
 * @see specs/components/hoverable-big-text-overflow.feature
 */
import { renderWithDesignSystem } from "@langwatch/design-system/testing";
import { cleanup } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { HoverableBigText } from "../hoverable-big-text.tsx";

describe("HoverableBigText overflow probe lifetime", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  describe("given the text is on the page with a measurement pending", () => {
    describe("when it is unmounted before the measurement runs", () => {
      /** @scenario "The overflow measurement is dropped when the text is unmounted" */
      it("leaves nothing scheduled that could run after the page is gone", () => {
        const view = renderWithDesignSystem(<HoverableBigText>a very long value</HoverableBigText>);
        expect(vi.getTimerCount()).toBeGreaterThan(0);

        view.unmount();

        expect(vi.getTimerCount()).toBe(0);
        expect(() => vi.runAllTimers()).not.toThrow();
      });
    });
  });
});
