/**
 * @vitest-environment jsdom
 *
 * HoverableBigText measures its own box on a timer, because the measurement is
 * only meaningful once the browser has laid the box out. A measurement left
 * scheduled after the component is gone is not a leak that costs memory, it is
 * a test-suite failure with no signal: the callback lands after the jsdom
 * environment has been torn down, throws `window is not defined` outside any
 * test's stack, and the shard exits non-zero while its own summary reports
 * every test as passing. Whichever file happens to be running at that moment
 * wears the blame.
 *
 * Spec: specs/components/hoverable-big-text-overflow.feature
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { HoverableBigText } from "../hoverable-big-text";

const renderText = () =>
  render(<HoverableBigText>a very long value</HoverableBigText>, {
    wrapper: ({ children }) => (
      <ChakraProvider value={defaultSystem}>{children}</ChakraProvider>
    ),
  });

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

        expect(
          vi.getTimerCount(),
          "no measurement may outlive the component",
        ).toBe(0);
        expect(() => vi.runAllTimers()).not.toThrow();
      });
    });
  });
});
