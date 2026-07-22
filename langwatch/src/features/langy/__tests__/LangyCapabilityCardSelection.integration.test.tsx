/**
 * @vitest-environment jsdom
 *
 * From a CLI payload to a drawn card — the whole selection path in one test.
 *
 * The path has three links and each one used to be tested on its own: the CLI
 * shapes a result (`toTimeseriesShape`), the command boundary stamps the card
 * it earned (`toCliToolResult`), and the panel draws that card. Every link was
 * green while the chain was broken in the middle — the panel re-derived the
 * card from the command's NAME and dropped any result whose stamped card
 * disagreed, which is exactly and only what a promotion produces. So the chart
 * card, the shape mapper and the probe layer all shipped without ever drawing
 * a single pixel. These tests run the links together, over payloads shaped the
 * way the real commands shape them.
 *
 * Boundary mocks: the project hook (deep links), the tRPC client (the chart's
 * "save to dashboard" menu), the hydration hook (a rows card refetches its
 * entities), and recharts' ResponsiveContainer — jsdom measures every element
 * as 0x0, at which recharts draws nothing for reasons that have nothing to do
 * with the code under test.
 *
 * Spec: specs/langy/langy-capability-cards.feature
 *       "The card a result was stamped with is the card that renders"
 * ADR:  dev/docs/adr/059-card-selection-is-deterministic.md
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { toCliToolResult } from "@langwatch/cli-cards";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import { cloneElement, type ReactElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { toTimeseriesShape } from "../../../../../typescript-sdk/src/cli/commands/analytics/timeseriesShape";

vi.mock("~/hooks/useOrganizationTeamProject", () => ({
  useOrganizationTeamProject: () => ({
    project: { id: "p_demo", slug: "demo" },
  }),
}));

vi.mock("~/utils/api", () => ({
  api: {
    dashboards: {
      getAll: { useQuery: () => ({ data: [] }) },
      create: { useMutation: () => ({ mutateAsync: vi.fn() }) },
    },
    graphs: { create: { useMutation: () => ({ mutateAsync: vi.fn() }) } },
  },
}));

vi.mock("../hooks/useCapabilityData", () => ({
  useCapabilityData: () => ({
    status: "idle",
    rows: [],
    loadedCount: 0,
    totalCount: null,
    isHydrating: false,
  }),
}));

vi.mock("recharts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("recharts")>();
  return {
    ...actual,
    // Typed with the props being injected: a bare `ReactElement` has unknown
    // props, so `cloneElement` has no overload that accepts these.
    ResponsiveContainer: ({
      children,
    }: {
      children: ReactElement<{ width?: number; height?: number }>;
    }) => cloneElement(children, { width: 640, height: 200 }),
  };
});

import { LangyCapabilityRenderer } from "../components/capabilities/LangyCapabilityRenderer";

afterEach(cleanup);

/**
 * `langwatch analytics query --metric total-cost`, as the command really
 * answers it: the analytics API's own buckets (keyed the way
 * `buildSeriesName` writes them — `<index>/<metric>/<aggregation>`), plus the
 * resolved metric and the card-shaped view the CLI derives from them.
 */
function analyticsCostQueryPayload() {
  const day = (index: number) => Date.UTC(2026, 6, 13 + index);
  const key = "0/performance.total_cost/sum";
  const currentPeriod = [0.11, 0.28, 0.19, 0.22, 0.31, 0.24, 0.36].map(
    (value, index) => ({ date: day(index), [key]: value }),
  );
  const previousPeriod = [0.08, 0.09, 0.12, 0.07, 0.11, 0.1, 0.14].map(
    (value, index) => ({ date: day(index) - 7 * 86400_000, [key]: value }),
  );
  const metric = "performance.total_cost";

  return {
    ...{ currentPeriod, previousPeriod },
    metric,
    aggregation: "sum",
    ...(toTimeseriesShape({ currentPeriod, previousPeriod, metric }) ?? {}),
  };
}

/** `langwatch virtual-keys list` — a plain array of keys, no cost anywhere. */
const virtualKeysListPayload = [
  {
    id: "vk_1",
    name: "checkout-agent",
    environment: "live",
    prefix: "lw_vk_live",
    last_four: "9f2c",
    status: "ACTIVE",
    scopes: [{ scope_type: "PROJECT", scope_id: "p_demo" }],
    created_at: "2026-07-01T09:00:00.000Z",
  },
];

/**
 * A settled call carrying the result the CLI envelope recorded for it — the
 * same stamp the worker writes into the event log, so the card the panel draws
 * is the card the boundary decided.
 */
function settledCall({
  name,
  resource,
  verb,
  payload,
}: {
  name: string;
  resource: string;
  verb: string;
  payload: unknown;
}) {
  return {
    name,
    state: "output-available",
    input: {},
    output: JSON.stringify(payload),
    result: toCliToolResult({ resource, verb, payload }),
  };
}

function renderCall(call: Parameters<typeof LangyCapabilityRenderer>[0]["call"]) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <ChakraProvider value={defaultSystem}>
        <LangyCapabilityRenderer call={call} />
      </ChakraProvider>
    </QueryClientProvider>,
  );
}

const plot = () => document.querySelector(".recharts-surface");

describe("given the CLI answered a cost question over the last week", () => {
  describe("when the panel renders the call", () => {
    /** @scenario A cost question over time renders as a chart */
    it("draws the trend as a plot", () => {
      renderCall(
        settledCall({
          name: "langwatch.analytics.query",
          resource: "analytics",
          verb: "query",
          payload: analyticsCostQueryPayload(),
        }),
      );

      expect(plot()).not.toBeNull();
      // One filled area per named series — the series is on screen, not merely
      // an empty axis frame.
      expect(document.querySelectorAll(".recharts-area").length).toBe(1);
      // Titled by the metric that was asked for, which is the CLI's own
      // reading of `performance.total_cost` and not a guess made here.
      expect(screen.getByText("Total cost")).toBeTruthy();
    });

    /** @scenario A cost question over time renders as a chart */
    it("names the period it compares against", () => {
      renderCall(
        settledCall({
          name: "langwatch.analytics.query",
          resource: "analytics",
          verb: "query",
          payload: analyticsCostQueryPayload(),
        }),
      );

      expect(screen.getByText("This period")).toBeTruthy();
      expect(screen.getByText("Previous period")).toBeTruthy();
    });
  });
});

describe("given a result recorded as a richer card than its command name implies", () => {
  describe("when the panel renders the call", () => {
    /** @scenario A result that earned a richer card than its name implies still renders */
    it("draws the recorded card rather than dropping the result", () => {
      const { container } = renderCall({
        name: "langwatch.analytics.query",
        state: "output-available",
        input: {},
        output: null,
        // The stamp a stored turn carries: the boundary decided `timeseries`,
        // while the command's name alone would only ever say `metrics`.
        result: {
          kind: "card",
          card: "timeseries",
          payload: {
            series: [
              {
                name: "Total cost",
                points: [
                  { t: "2026-07-13", v: 0.11 },
                  { t: "2026-07-14", v: 0.28 },
                ],
              },
            ],
            title: "Total cost",
            unit: "usd",
          },
        },
      });

      expect(container.innerHTML).not.toBe("");
      expect(plot()).not.toBeNull();
    });
  });
});

describe("given a listing that carries neither a trend nor a total", () => {
  describe("when the panel renders the call", () => {
    /** @scenario A result that earned nothing richer keeps the card its name gave it */
    it("keeps the card the command's name earned", () => {
      renderCall(
        settledCall({
          name: "langwatch.virtual-keys.list",
          resource: "virtual-keys",
          verb: "list",
          payload: virtualKeysListPayload,
        }),
      );

      expect(screen.getByText("Virtual keys")).toBeTruthy();
      expect(screen.getByText("checkout-agent")).toBeTruthy();
      expect(plot()).toBeNull();
    });
  });
});
