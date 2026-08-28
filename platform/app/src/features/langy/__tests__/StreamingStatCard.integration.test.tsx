/** @vitest-environment jsdom */
/**
 * @see specs/langy/langy-derived-stats-presentation.feature
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { StreamingStatCard } from "@langwatch/langy-web";

/**
 * The ticker springs the number up from zero, so a test that reads the DOM
 * mid-spring reads a number nobody asked about. Reduced motion renders the
 * settled value on first paint, which is the value under test.
 */
function preferReducedMotion() {
  vi.stubGlobal(
    "matchMedia",
    vi.fn().mockImplementation((query: string) => ({
      matches: query.includes("prefers-reduced-motion"),
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
      onchange: null,
    })),
  );
}

function renderCard(
  metrics: Parameters<typeof StreamingStatCard>[0]["metrics"],
) {
  return render(
    <ChakraProvider value={defaultSystem}>
      <StreamingStatCard metrics={metrics} />
    </ChakraProvider>,
  );
}

describe("StreamingStatCard", () => {
  beforeEach(() => {
    preferReducedMotion();
  });

  describe("given a metric with a suffix and a reading smaller than a hundredth", () => {
    /** @scenario "A live turn metric with a suffix keeps the digits of a small reading" */
    it("keeps the digits rather than drawing the reading as zero", () => {
      renderCard([{ value: 0.0001543, label: "cost per row", suffix: " usd" }]);

      expect(screen.getByText("0.0001543 usd")).toBeTruthy();
      expect(screen.queryByText("0 usd")).toBeNull();
    });
  });

  describe("given a metric with a suffix and a whole reading", () => {
    it("draws the grouped number with the suffix", () => {
      renderCard([{ value: 1204, label: "traces", suffix: " traces" }]);

      expect(screen.getByText("1,204 traces")).toBeTruthy();
    });
  });

  describe("given a metric with its own formatter", () => {
    it("lets the formatter own the drawing", () => {
      renderCard([
        {
          value: 0.0001543,
          label: "cost",
          suffix: " usd",
          format: (n) => `$${n.toFixed(6)}`,
        },
      ]);

      expect(screen.getByText("$0.000154")).toBeTruthy();
    });
  });
});
