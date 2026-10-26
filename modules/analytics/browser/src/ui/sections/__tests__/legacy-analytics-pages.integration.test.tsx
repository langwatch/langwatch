/**
 * @vitest-environment jsdom
 * A smoke test of the legacy analytics pages beside Dashboards: the overview page draws
 * under the real tRPC hooks and reads its charts from the legacy analytics procedures, not
 * from LWQL. Only the network is answered from the test.
 * @see modules/dashboard/specs/dashboards-v1.feature
 */

import { createUiQueryClient } from "@langwatch/browser/query-client";
import { answeringUiTransport, type UiProcedureCall } from "@langwatch/browser/testing-transport";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { analyticsApi } from "../../../behavior/analytics-api.ts";
import { AnalyticsTestHarness, StubAnalyticsHost } from "../../../testing.tsx";
import AnalyticsOverviewScreen from "../analytics/analytics-overview.screen.tsx";

/** Answers every read with an empty result of its shape; every call is kept. */
function legacyServer() {
  const calls: UiProcedureCall[] = [];
  const answer = (call: UiProcedureCall): Promise<unknown> => {
    calls.push(call);
    switch (call.path) {
      case "analytics.getTimeseries":
        return Promise.resolve({ previousPeriod: [], currentPeriod: [] });
      default:
        return Promise.reject(new Error(`No test answer for ${call.path}`));
    }
  };
  return { calls, answer };
}

afterEach(cleanup);

describe("given a member opens the legacy analytics overview", () => {
  let calls: UiProcedureCall[] = [];
  beforeEach(() => {
    const server = legacyServer();
    calls = server.calls;
    const host = new StubAnalyticsHost({
      project: { id: "proj-1", slug: "checkout", name: "Checkout Agent", hasFirstMessage: true },
    });
    render(
      <AnalyticsTestHarness host={host}>
        <analyticsApi.Provider
          client={answeringUiTransport(server.answer)}
          queryClient={createUiQueryClient({ onMutationError: () => void 0 })}
        >
          <AnalyticsOverviewScreen />
        </analyticsApi.Provider>
      </AnalyticsTestHarness>,
    );
  });

  /** @scenario "AC20 Legacy analytics pages behave exactly as before" */
  it("draws the page with its analytics tabs", () => {
    expect(screen.getByRole("navigation", { name: "Analytics pages" })).toBeInTheDocument();
  });

  /** @scenario "AC20 Legacy analytics pages behave exactly as before" */
  it("reads its charts from the legacy timeseries procedure", async () => {
    await waitFor(() => expect(calls.map(({ path }) => path)).toContain("analytics.getTimeseries"));
  });

  /** @scenario "AC20 Legacy analytics pages behave exactly as before" */
  it("sends no LWQL query", async () => {
    await vi.waitUntil(() => calls.length > 0);
    expect(
      calls.map(({ path }) => path).filter((path) => path.startsWith("analytics.lwql.")),
    ).toEqual([]);
  });
});
