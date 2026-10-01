/**
 * @vitest-environment jsdom
 * HoverableBigText: measures box on timer after browser layout.
 */
import { renderWithDesignSystem } from "@langwatch/design-system/testing";
import { cleanup } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { HoverableBigText } from "../hoverable-big-text.tsx";

const renderText = () =>
  renderWithDesignSystem(<HoverableBigText>a very long value</HoverableBigText>);

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
      /** @scenario The overflow measurement is dropped when the text is unmounted */
      it("leaves nothing scheduled that could run after the page is gone", () => {
        const view = renderText();
        expect(
          vi.getTimerCount(),
          "the probe must be scheduled for this test to mean anything",
        ).toBeGreaterThan(0);

        view.unmount();

        expect(vi.getTimerCount(), "no measurement may outlive the component").toBe(0);
        expect(() => vi.runAllTimers()).not.toThrow();
      });
    });
  });
});
