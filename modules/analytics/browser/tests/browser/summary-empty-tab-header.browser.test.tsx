/**
 * WEB-986: three empty summaries side by side in narrow tab headers. The chart
 * placeholder text used to spill into the neighbouring tab; jsdom has no layout.
 */
import { Tabs } from "@langwatch/design-system/primitives";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/behavior/analytics-api.ts", () => ({
  analyticsApi: {
    analytics: {
      getTimeseries: {
        useQuery: () => ({
          data: { previousPeriod: [], currentPeriod: [] },
          error: null,
          isLoading: false,
          isFetching: false,
          refetch: () => undefined,
        }),
      },
    },
    useUtils: () => ({ analytics: {} }),
  },
}));

vi.mock("../../src/behavior/use-filter-params.ts", () => ({
  useFilterParams: () => ({
    filterParams: { projectId: "project-1", startDate: 0, endDate: 1, filters: {} },
    queryOpts: { enabled: true },
  }),
}));

import { AnalyticsTestHarness, StubAnalyticsHost } from "../../src/testing.tsx";
import { CustomGraph, type CustomGraphInput } from "../../src/ui/sections/custom-graph.tsx";

afterEach(cleanup);

const summary = (name: string): CustomGraphInput => ({
  graphId: name,
  graphType: "summary",
  series: [{ name, metric: "metadata.trace_id", aggregation: "cardinality", colorSet: "colors" }],
  includePrevious: false,
  timeScale: "full",
});

describe("given three empty summaries in narrow tab headers", () => {
  /** @scenario "An empty summary keeps its figure labels inside its own bounds" */
  it("keeps every figure inside its own tab", () => {
    const names = ["Messages", "Threads", "Users"];
    render(
      <AnalyticsTestHarness host={new StubAnalyticsHost()}>
        <div style={{ width: "220px" }}>
          <Tabs.Root defaultValue="Messages">
            <Tabs.List>
              {names.map((name) => (
                <Tabs.Trigger key={name} value={name} style={{ width: "72px", minWidth: 0 }}>
                  <CustomGraph input={summary(name)} />
                </Tabs.Trigger>
              ))}
            </Tabs.List>
          </Tabs.Root>
        </div>
      </AnalyticsTestHarness>,
    );

    expect(screen.queryByText("No data. Try adjusting the date range.")).toBeNull();
    for (const tab of screen.getAllByRole("tab")) {
      const bounds = tab.getBoundingClientRect();
      for (const text of tab.querySelectorAll("p, h2")) {
        const box = text.getBoundingClientRect();
        expect(box.left).toBeGreaterThanOrEqual(bounds.left - 1);
        expect(box.left).toBeLessThan(bounds.right);
      }
    }
  });
});
