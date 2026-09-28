/**
 * @vitest-environment jsdom
 * The Flight Deck panel states against a fake LangWatchQL endpoint that
 * answers by statement: call to action, empty period, and one failing panel
 * that retries alone. @see modules/dashboard/specs/dashboards-v1.feature
 */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { renderWithAnalyticsHost } from "../../../../testing.tsx";
import { type BlockSource, SOURCE_EXISTENCE_SQL } from "../model/block-definition.ts";
import {
  COST_BY_MODEL_SQL,
  COST_SUMMARY_SQL,
  FAILURES_SQL,
  PERIOD_COMPARISON_SQL,
} from "../model/block-queries.ts";
import { FlightDeckPanels } from "../ui/dashboard-block.tsx";

/** An in-memory LangWatchQL endpoint: rows per statement, a failure set, and a log of what ran. */
const endpoint = vi.hoisted(() => {
  const state = {
    rows: new Map<string, readonly Record<string, unknown>[]>(),
    failing: new Set<string>(),
    ran: [] as string[],
  };
  const utils = {
    client: {
      analytics: {
        lwql: {
          query: {
            mutate: async ({ sql }: { sql: string }) => {
              state.ran.push(sql);
              if (state.failing.has(sql)) throw new Error("lwql_query_failed");
              return { columns: [], rows: state.rows.get(sql) ?? [], diagnostics: [] };
            },
          },
        },
      },
    },
  };
  return { state, utils };
});

vi.mock("../../../../behavior/analytics-api.ts", () => ({
  analyticsApi: { useUtils: () => endpoint.utils },
}));

const CONNECTED: readonly BlockSource[] = ["traces"];

function mountDeck() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return renderWithAnalyticsHost(
    <QueryClientProvider client={queryClient}>
      <FlightDeckPanels
        projectId="proj-1"
        periodStart={Date.UTC(2026, 8, 1)}
        periodEnd={Date.UTC(2026, 8, 8)}
        granularitySeconds={3600}
      />
    </QueryClientProvider>,
  );
}

const panel = (id: string) => screen.getByTestId(`dashboard-block-${id}`);
const timesRan = (sql: string) => endpoint.state.ran.filter((ran) => ran === sql).length;

describe("the Flight Deck panels", () => {
  beforeEach(() => {
    endpoint.state.rows = new Map([
      ...CONNECTED.map((source) => [SOURCE_EXISTENCE_SQL[source], [{ present: 1 }]] as const),
      [
        PERIOD_COMPARISON_SQL,
        [
          {
            requests: 120,
            requests_prev: 100,
            errors: 6,
            errors_prev: 5,
            p95_ms: 900,
            p95_ms_prev: 1000,
            cost: 12,
            cost_prev: 10,
          },
        ],
      ],
      [
        COST_SUMMARY_SQL,
        [{ traces: 120, cost: 12, successes: 114, tokens_in: 5000, tokens_out: 800 }],
      ],
      [COST_BY_MODEL_SQL, [{ model: "gpt-5", cost: 12 }]],
    ]);
    endpoint.state.failing = new Set();
    endpoint.state.ran = [];
  });
  afterEach(cleanup);

  describe("given a project that has never run a scenario", () => {
    /** @scenario "AC6 Unconnected source shows a call to action" */
    it("shows the Run a scenario call to action and its button opens the scenarios page", async () => {
      const { host } = mountDeck();

      const scenarios = panel("fd-scenarios");
      const button = await within(scenarios).findByRole("button", { name: "Run a scenario" });
      fireEvent.click(button);

      expect(host.navigations).toEqual(["/test-project/simulations/scenarios"]);
    });
  });

  describe("given a connected source with no rows in the period", () => {
    /** @scenario "AC9 Empty period shows an empty state" */
    it("shows No data yet, not an error and not the call to action", async () => {
      mountDeck();

      const failures = panel("fd-failures");
      await within(failures).findByText("No data yet");
      expect(within(failures).queryByTestId("block-error")).toBeNull();
      expect(within(failures).queryByTestId("block-not-connected")).toBeNull();
      expect(timesRan(FAILURES_SQL)).toBe(1);
    });
  });

  describe("when one panel's query fails", () => {
    /** @scenario "AC23 A failing query does not take the board down" */
    it("shows an error with a retry there while the other panels render, and retries that panel alone", async () => {
      endpoint.state.failing.add(COST_SUMMARY_SQL);
      mountDeck();

      const cost = panel("fd-cost");
      await within(cost).findByTestId("block-error");
      expect(within(cost).queryByText("No data yet")).toBeNull();
      expect(within(cost).queryByTestId("block-not-connected")).toBeNull();
      await within(panel("fd-status")).findByText("Request volume");
      const statusRuns = timesRan(PERIOD_COMPARISON_SQL);

      endpoint.state.failing.clear();
      fireEvent.click(within(cost).getByRole("button", { name: "Retry" }));

      await within(cost).findByText("Cost / success");
      expect(timesRan(COST_SUMMARY_SQL)).toBe(2);
      expect(timesRan(PERIOD_COMPARISON_SQL)).toBe(statusRuns);
    });
  });

  describe("when a source never recorded a row", () => {
    it("sends none of that panel's statements", async () => {
      mountDeck();

      await within(panel("fd-gateway")).findByTestId("block-not-connected");
      const ranOutsideExistence = endpoint.state.ran.filter(
        (sql) => sql.includes("gateway_request_spend") && sql !== SOURCE_EXISTENCE_SQL.gateway,
      );
      expect(ranOutsideExistence).toEqual([]);
    });
  });
});
