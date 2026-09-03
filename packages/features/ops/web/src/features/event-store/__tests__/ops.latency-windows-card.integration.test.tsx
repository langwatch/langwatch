/**
 * @vitest-environment jsdom
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { LatencyWindowsCard } from "../ui/elements/latency-windows-card";

afterEach(cleanup);

const withChakra = (node: React.ReactElement) =>
  render(<ChakraProvider value={defaultSystem}>{node}</ChakraProvider>);

describe("LatencyWindowsCard", () => {
  it("shows each window's percentiles, and a dash for a quiet window", () => {
    const { container } = withChakra(
      <LatencyWindowsCard
        windows={{
          hour: null,
          day: { p50Ms: 384, p99Ms: 1536, count: 5_000 },
          week: { p50Ms: 512, p99Ms: 3072, count: 40_000 },
          allTime: { p50Ms: 512, p99Ms: 3072, count: 120_000 },
        }}
      />,
    );
    expect(container.textContent).toContain("Last hour");
    expect(container.textContent).toContain("—");
    expect(container.textContent).toContain("384ms");
    expect(container.textContent).toContain("1.5s");
    expect(container.textContent).toContain("bucketed estimates");
    expect(container.textContent).toContain("120.0k completions all time");

    // P50/P99 are the metric COLUMNS (header cells); windows are the rows.
    const headerCells = [...container.querySelectorAll("th")].map(
      (cell) => cell.textContent,
    );
    expect(headerCells).toContain("P50");
    expect(headerCells).toContain("P99");
    expect(headerCells).not.toContain("Last hour");
  });

  it("renders nothing until the first detail cycle has produced windows", () => {
    withChakra(<LatencyWindowsCard windows={null} />);
    expect(screen.queryByText("Processing time by window")).toBeNull();
  });
});
