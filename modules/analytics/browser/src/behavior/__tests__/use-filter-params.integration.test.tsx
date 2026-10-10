/**
 * @vitest-environment jsdom
 * Spec: specs/analytics-timeseries.feature
 */

import { renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it } from "vitest";

import { AnalyticsTestHarness, StubAnalyticsHost } from "../../testing.tsx";
import { useFilterParams } from "../use-filter-params.ts";

describe("the analytics read scope", () => {
  /** @scenario "Langy's own turns are left out of every Analytics read" */
  it("excludes the langy origin, as the Trace Explorer does", () => {
    const host = new StubAnalyticsHost({ route: { params: {}, query: { period: "7d" } } });
    const wrapper = ({ children }: { children: ReactNode }) => (
      <AnalyticsTestHarness host={host}>{children}</AnalyticsTestHarness>
    );
    const { result } = renderHook(() => useFilterParams(), { wrapper });

    expect(result.current.filterParams.excludeOrigins).toEqual(["langy"]);
  });
});
