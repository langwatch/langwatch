/**
 * @vitest-environment jsdom
 * The Flight Deck panel states against an in-memory server answering
 * `dashboards.sourcePresence` and LangWatchQL by statement: call to action,
 * data, empty period, and failures that retry alone.
 * @see modules/dashboard/specs/dashboards-v1.feature
 */

import {
  type UiProcedureCall,
  UiProcedureRefusal,
} from "@langwatch/browser-host/testing-transport";
import type { DashboardSourcePresence } from "@langwatch/dashboard-contract";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { StubAnalyticsHost } from "../../../../testing.tsx";
import {
  NO_PROCEDURES,
  renderDashboards,
} from "../../__tests__/render-dashboards.test-helpers.tsx";
import { type BlockSource, SOURCE_CALLS_TO_ACTION } from "../model/block-definition.ts";
import {
  COST_BY_MODEL_SQL,
  COST_SUMMARY_SQL,
  FAILURES_SQL,
  PERIOD_COMPARISON_SQL,
} from "../model/block-queries.ts";
import { FLIGHT_DECK_BLOCKS } from "../model/block-registry.ts";
import { FlightDeckPanels } from "../ui/dashboard-block.tsx";

const ONLY_TRACES: DashboardSourcePresence = {
  traces: "present",
  scenarios: "absent",
  judges: "absent",
  feedback: "absent",
  gateway: "absent",
  codingAgents: "absent",
};

const TRACE_ROWS = new Map<string, readonly Record<string, unknown>[]>([
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
  [COST_SUMMARY_SQL, [{ traces: 120, cost: 12, successes: 114, tokens_in: 5000, tokens_out: 800 }]],
  [COST_BY_MODEL_SQL, [{ model: "gpt-5", cost: 12 }]],
]);

/** Source presence and LangWatchQL, answered from memory; every call is kept. */
function inMemoryServer({ presence = ONLY_TRACES }: { presence?: DashboardSourcePresence } = {}) {
  const state = { presence, failing: new Set<string>(), ran: [] as string[] };
  const calls: UiProcedureCall[] = [];
  const answer = (call: UiProcedureCall): Promise<unknown> => {
    calls.push(call);
    if (call.path === "dashboards.sourcePresence") return Promise.resolve(state.presence);
    if (call.path !== "analytics.lwql.query") return NO_PROCEDURES(call);
    const { sql } = call.input as { sql: string };
    state.ran.push(sql);
    if (state.failing.has(sql))
      return Promise.reject(new UiProcedureRefusal("lwql_query_failed", 500));
    return Promise.resolve({ columns: [], rows: TRACE_ROWS.get(sql) ?? [], diagnostics: [] });
  };
  return { state, calls, answer };
}

function mountDeck(server: ReturnType<typeof inMemoryServer>) {
  const host = new StubAnalyticsHost();
  renderDashboards({
    element: (
      <FlightDeckPanels
        projectId="proj-1"
        periodStart={Date.UTC(2026, 8, 1)}
        periodEnd={Date.UTC(2026, 8, 8)}
        granularitySeconds={3600}
      />
    ),
    host,
    answer: server.answer,
  });
  return { host };
}

const panel = (id: string) => screen.getByTestId(`dashboard-block-${id}`);
const OPTIONAL_PANELS = FLIGHT_DECK_BLOCKS.filter((block) => block.source !== "traces");
const statementsOf = (source: BlockSource) =>
  FLIGHT_DECK_BLOCKS.filter((block) => block.source === source).flatMap((block) =>
    block.queries.map(({ sql }) => sql),
  );

describe("the Flight Deck panels", () => {
  afterEach(cleanup);

  describe("given a project that has never run a scenario", () => {
    /** @scenario "AC6 Unconnected source shows a call to action" */
    it("shows the Run a scenario call to action and its button opens the scenarios page", async () => {
      const { host } = mountDeck(inMemoryServer());

      const scenarios = panel("fd-scenarios");
      const button = await within(scenarios).findByRole("button", { name: "Run a scenario" });
      fireEvent.click(button);

      expect(host.navigations).toEqual(["/test-project/simulations/scenarios"]);
    });
  });

  describe("given a project that has ingested traces", () => {
    /** @scenario "AC7 Connected state comes from real data" */
    it("draws the trace panels from the queried rows, asking presence once for the board", async () => {
      const server = inMemoryServer();
      mountDeck(server);

      await within(panel("fd-status")).findByText("Request volume");
      expect(within(panel("fd-status")).queryByTestId("block-not-connected")).toBeNull();
      expect(server.state.ran).toContain(PERIOD_COMPARISON_SQL);
      expect(server.calls.filter((call) => call.path === "dashboards.sourcePresence")).toEqual([
        { path: "dashboards.sourcePresence", input: { projectId: "proj-1" } },
      ]);
    });
  });

  describe.each(OPTIONAL_PANELS.map((block) => [block.title, block] as const))(
    "given a project that never recorded a row for %s",
    (title, block) => {
      /** @scenario "AC25 Scenario results shows its own call to action before any row exists" */
      /** @scenario "AC25 Quality signal shows its own call to action before any row exists" */
      /** @scenario "AC25 User feedback shows its own call to action before any row exists" */
      /** @scenario "AC25 Gateway routing shows its own call to action before any row exists" */
      /** @scenario "AC25 Your coding agents shows its own call to action before any row exists" */
      it(`shows ${title}'s own call to action, not the empty state, and runs none of its statements`, async () => {
        const server = inMemoryServer();
        mountDeck(server);

        const card = panel(block.id);
        const cta = SOURCE_CALLS_TO_ACTION[block.source];
        const invitation = await within(card).findByTestId("block-not-connected");
        expect(invitation).toHaveTextContent(cta.title);
        expect(invitation).toHaveTextContent(cta.line);
        expect(within(card).getByRole("button", { name: cta.button })).toBeInTheDocument();
        expect(within(card).queryByText("No data yet")).toBeNull();
        const own = statementsOf(block.source);
        expect(server.state.ran.filter((sql) => own.includes(sql))).toEqual([]);
      });

      /** @scenario "AC25 Scenario results shows its own call to action before any row exists" */
      /** @scenario "AC25 Quality signal shows its own call to action before any row exists" */
      /** @scenario "AC25 User feedback shows its own call to action before any row exists" */
      /** @scenario "AC25 Gateway routing shows its own call to action before any row exists" */
      /** @scenario "AC25 Your coding agents shows its own call to action before any row exists" */
      it(`queries ${title} once a row exists`, async () => {
        const server = inMemoryServer({ presence: { ...ONLY_TRACES, [block.source]: "present" } });
        mountDeck(server);

        const own = statementsOf(block.source);
        await waitFor(() => expect(server.state.ran.some((sql) => own.includes(sql))).toBe(true));
        expect(within(panel(block.id)).queryByTestId("block-not-connected")).toBeNull();
      });
    },
  );

  describe("given the server could not check a source", () => {
    /** @scenario "AC23 A failing query does not take the board down" */
    it("shows an error with a retry there, not the call to action, and retries the check", async () => {
      const server = inMemoryServer({ presence: { ...ONLY_TRACES, scenarios: "failed" } });
      mountDeck(server);

      const scenarios = panel("fd-scenarios");
      await within(scenarios).findByTestId("block-error");
      expect(within(scenarios).queryByTestId("block-not-connected")).toBeNull();

      server.state.presence = ONLY_TRACES;
      fireEvent.click(within(scenarios).getByRole("button", { name: "Retry" }));

      expect(await within(scenarios).findByTestId("block-not-connected")).toBeInTheDocument();
    });
  });

  describe("given a connected source with no rows in the period", () => {
    /** @scenario "AC9 Empty period shows an empty state" */
    it("shows No data yet, not an error and not the call to action", async () => {
      const server = inMemoryServer();
      mountDeck(server);

      const failures = panel("fd-failures");
      await within(failures).findByText("No data yet");
      expect(within(failures).queryByTestId("block-error")).toBeNull();
      expect(within(failures).queryByTestId("block-not-connected")).toBeNull();
      expect(server.state.ran.filter((sql) => sql === FAILURES_SQL)).toHaveLength(1);
    });
  });

  describe("when one panel's query fails", () => {
    /** @scenario "AC23 A failing query does not take the board down" */
    it("shows an error with a retry there while the other panels render, and retries that panel alone", async () => {
      const server = inMemoryServer();
      server.state.failing.add(COST_SUMMARY_SQL);
      mountDeck(server);
      const timesRan = (sql: string) => server.state.ran.filter((ran) => ran === sql).length;

      const cost = panel("fd-cost");
      await within(cost).findByTestId("block-error");
      expect(within(cost).queryByText("No data yet")).toBeNull();
      expect(within(cost).queryByTestId("block-not-connected")).toBeNull();
      await within(panel("fd-status")).findByText("Request volume");
      const statusRuns = timesRan(PERIOD_COMPARISON_SQL);

      server.state.failing.clear();
      fireEvent.click(within(cost).getByRole("button", { name: "Retry" }));

      await within(cost).findByText("Cost / success");
      expect(timesRan(COST_SUMMARY_SQL)).toBe(2);
      expect(timesRan(PERIOD_COMPARISON_SQL)).toBe(statusRuns);
    });
  });
});
