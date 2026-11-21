// @vitest-environment jsdom
/**
 * A card's (i) line holds what the server limited: a project left out of the run is one such
 * limit, a note on where shared rows sit is not.
 * @see modules/dashboard/specs/dashboards-v2.feature AC213
 */
import type { DashboardWidgetQuery } from "@langwatch/analytics-contract/dashboard-widget-definition";
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const { mutate } = vi.hoisted(() => ({ mutate: vi.fn() }));

vi.mock("../../../../behavior/analytics-api.ts", () => ({
  analyticsApi: {
    useUtils: () => ({ client: { analytics: { lwql: { query: { mutate } } } } }),
  },
}));

import { useDashboardWidgetExecutor } from "../use-dashboard-widget-executor.ts";

const QUERY: DashboardWidgetQuery = { name: "main", sql: "SELECT 1 AS n" };
const MISSING = "Some projects are not shared with this read, so none of their rows are included";

describe("given a run the server answers with SHARE_WINDOW_MISSING", () => {
  /** @scenario "AC213 Diagnostics: a card shows what the server limited as one (i) line" */
  it("puts its message on the (i) line, and not the shared-rows note beside it", async () => {
    mutate.mockReset();
    mutate.mockResolvedValue({
      columns: [],
      rows: [],
      statistics: { elapsedMs: 1, rowsRead: 0, bytesRead: 0, rowsReturned: 0 },
      diagnostics: [
        { code: "SHARE_WINDOW_MISSING", message: MISSING },
        { code: "SHARED_ROWS_UNDER_LOWEST_PROJECT", message: "Shared rows sit under one project." },
      ],
      followsTimeWindow: false,
      followsGranularity: false,
    });
    const { result } = renderHook(() => useDashboardWidgetExecutor("proj-a", [QUERY]));

    await act(async () => {
      await result.current.executeQuery({
        queryName: "main",
        params: {},
        signal: new AbortController().signal,
      });
    });

    expect(result.current.limits).toEqual([MISSING]);
  });
});
