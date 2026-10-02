/**
 * @vitest-environment jsdom
 * From a CLI payload to a drawn card: stamp with `toCliToolResult`, render.
 * Mocks: host, tRPC, router, hydration hook, recharts' ResponsiveContainer.
 * Spec: specs/langy/langy-capability-cards.feature
 */
import { DesignSystemProvider } from "@langwatch/design-system/provider";
import { toCliToolResult } from "@langwatch/langy-contract";
import { cleanup, render, screen } from "@testing-library/react";
import { cloneElement, type ReactElement } from "react";
import type * as rechartsModule from "recharts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  LangyHostApi,
  LangyHostProvider,
  type LangyHostOrganization,
  type LangyHostProject,
  type LangyHostTeam,
  type LangyRouteReading,
} from "../../../../../../model/langy-host.ts";

class FakeLangyHost extends LangyHostApi {
  project(): LangyHostProject | undefined {
    return { id: "p_demo", slug: "demo", name: "demo" };
  }
  organization(): LangyHostOrganization | undefined {
    return { id: "org-1" };
  }
  team(): LangyHostTeam | undefined {
    return { id: "team-1" };
  }
  organizationRole() {
    return "MEMBER";
  }
  currentUser() {
    return { id: "user-1", email: "staff@langwatch.ai" };
  }
  hasPermission() {
    return true;
  }
  isLoading() {
    return false;
  }
  isDemoProject() {
    return false;
  }
  featureFlag() {
    return true;
  }
  route(): LangyRouteReading {
    return { params: {}, query: {}, pathname: "/" };
  }
  setQuery() {}
  navigate() {}
  planManagementUrl() {
    return undefined;
  }
  succeeded() {}
  failed() {}
}
const host = new FakeLangyHost();

vi.mock("@langwatch/browser-host/use-router", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

vi.mock("../../../../../../behavior/langy-api.ts", () => ({
  api: {
    dashboards: {
      getAll: { useQuery: () => ({ data: [] }) },
      create: { useMutation: () => ({ mutateAsync: vi.fn() }) },
    },
    graphs: { create: { useMutation: () => ({ mutateAsync: vi.fn() }) } },
  },
}));

vi.mock("../../../../behavior/use-capability-data.ts", () => ({
  useCapabilityData: () => ({
    status: "idle",
    rows: [],
    loadedCount: 0,
    totalCount: null,
    isHydrating: false,
  }),
}));

vi.mock("recharts", async (importOriginal) => {
  const actual = await importOriginal<typeof rechartsModule>();
  return {
    ...actual,
    ResponsiveContainer: ({
      children,
    }: {
      children: ReactElement<{ width?: number; height?: number }>;
    }) => cloneElement(children, { width: 640, height: 200 }),
  };
});

import { LangyCapabilityRenderer } from "../langy-capability-renderer.tsx";

afterEach(cleanup);

/**
 * `langwatch analytics query --metric total-cost` as the command answers it:
 * the API's buckets keyed `<index>/<metric>/<aggregation>`, plus the resolved
 * metric and the card-shaped view.
 */
function analyticsCostQueryPayload() {
  const day = (index: number) => Date.UTC(2026, 6, 13 + index);
  const key = "0/performance.total_cost/sum";
  const currentPeriod = [0.11, 0.28, 0.19, 0.22, 0.31, 0.24, 0.36].map((value, index) => ({
    date: day(index),
    [key]: value,
  }));
  const previousPeriod = [0.08, 0.09, 0.12, 0.07, 0.11, 0.1, 0.14].map((value, index) => ({
    date: day(index) - 7 * 86400_000,
    [key]: value,
  }));
  const metric = "performance.total_cost";

  const points = (buckets: { date: number; [key: string]: number }[]) =>
    buckets.map((bucket) => ({
      t: new Date(bucket.date).toISOString().slice(0, 10),
      v: bucket[key]!,
    }));
  const sum = (values: number[]) => values.reduce((total, value) => total + value, 0);

  return {
    currentPeriod,
    previousPeriod,
    metric,
    aggregation: "sum",
    // The card-shaped view the CLI derives (`toTimeseriesShape`, pinned in the SDK's own tests).
    series: [{ name: "Total cost", points: points(currentPeriod) }],
    title: "Total cost",
    unit: "usd",
    comparison: {
      label: "This period",
      value: sum(currentPeriod.map((bucket) => bucket[key]!)),
      baselineLabel: "Previous period",
      baseline: sum(previousPeriod.map((bucket) => bucket[key]!)),
    },
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
  return render(
    <DesignSystemProvider forcedTheme="light">
      <LangyHostProvider value={host}>
        <LangyCapabilityRenderer call={call} />
      </LangyHostProvider>
    </DesignSystemProvider>,
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

/**
 * `analytics query --metric trace-count --group-by metadata.model
 * --time-scale full`: one bucket, the count nested under the dimension and the
 * model. One bucket is not a trend, so the metrics card draws it.
 */
function traceCountByModelPayload() {
  return {
    currentPeriod: [
      {
        date: "full",
        "metadata.model": {
          "gpt-5-mini": { "0/metadata.trace_id/cardinality": 7 },
        },
      },
    ],
    previousPeriod: [],
    metric: "metadata.trace_id",
    aggregation: "cardinality",
  };
}

/** The ticker springs up from zero; reduced motion paints the settled value. */
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

describe("given the CLI counted the project's traces split by model", () => {
  beforeEach(preferReducedMotion);
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe("when the panel renders the call", () => {
    function renderTraceCount() {
      renderCall(
        settledCall({
          name: "langwatch.analytics.query",
          resource: "analytics",
          verb: "query",
          payload: traceCountByModelPayload(),
        }),
      );
    }

    /** @scenario A trace count split by model reads as a count of traces */
    it("titles the card by what was counted", () => {
      renderTraceCount();

      expect(screen.getByText("Traces")).toBeTruthy();
      expect(screen.queryByText("Trace id")).toBeNull();
    });

    /** @scenario A trace count split by model reads as a count of traces */
    it("reads the grouped count as the headline figure", () => {
      renderTraceCount();

      expect(screen.getByText("traces")).toBeTruthy();
      expect(screen.getAllByText("7")).toHaveLength(2);
      expect(screen.queryByText("0")).toBeNull();
    });

    /** @scenario A trace count split by model reads as a count of traces */
    it("captions the model's figure with the model's name", () => {
      renderTraceCount();

      expect(screen.getByText("gpt-5-mini")).toBeTruthy();
      expect(screen.getByText("By model")).toBeTruthy();
    });

    /** @scenario A trace count split by model reads as a count of traces */
    it("never shows the aggregation name or a bucket count", () => {
      renderTraceCount();

      expect(screen.queryByText("cardinality")).toBeNull();
      expect(screen.queryByText("point")).toBeNull();
      expect(screen.queryByText("1")).toBeNull();
      expect(plot()).toBeNull();
    });
  });
});

/**
 * `--metric avg-latency --group-by metadata.model --time-scale full`: one
 * bucket, each model's average nested under the dimension. Averages of groups
 * do not add up, so the card must not draw their sum as the period's figure.
 */
function averageLatencyByModelPayload() {
  return {
    currentPeriod: [
      {
        date: "full",
        "metadata.model": {
          "gpt-5-mini": { "0/performance.completion_time/avg": 1 },
          "gpt-5.6-terra": { "0/performance.completion_time/avg": 3 },
        },
      },
    ],
    previousPeriod: [],
    metric: "performance.completion_time",
    aggregation: "avg",
  };
}

describe("given the CLI averaged latency split by model", () => {
  beforeEach(preferReducedMotion);
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe("when the panel renders the call", () => {
    /** @scenario A grouped average is never summed into one figure */
    it("draws each model's average and no summed headline", () => {
      renderCall(
        settledCall({
          name: "langwatch.analytics.query",
          resource: "analytics",
          verb: "query",
          payload: averageLatencyByModelPayload(),
        }),
      );

      expect(screen.getByText("gpt-5-mini")).toBeTruthy();
      expect(screen.getByText("gpt-5.6-terra")).toBeTruthy();
      expect(screen.getByText("1")).toBeTruthy();
      expect(screen.getByText("3")).toBeTruthy();
      expect(screen.queryByText("4")).toBeNull();
      expect(screen.queryByText("average")).toBeNull();
    });

    /** @scenario A grouped average is never summed into one figure */
    it("says there is no single figure when every group spans several days", () => {
      const byModel = (mini: number, terra: number) => ({
        "metadata.model": {
          "gpt-5-mini": { "0/performance.completion_time/avg": mini },
          "gpt-5.6-terra": { "0/performance.completion_time/avg": terra },
        },
      });
      renderCall(
        settledCall({
          name: "langwatch.analytics.query",
          resource: "analytics",
          verb: "query",
          payload: {
            ...averageLatencyByModelPayload(),
            currentPeriod: [
              { date: "2026-09-28", ...byModel(1, 3) },
              { date: "2026-09-29", ...byModel(2, 4) },
            ],
          },
        }),
      );

      expect(screen.getByText(/spans several periods or groups, so it has no single/)).toBeTruthy();
      expect(screen.queryByText("No data for this period.")).toBeNull();
      expect(screen.queryByText("10")).toBeNull();
    });
  });
});

/** A distinct count of `metric` per day, as the analytics API answers it. */
function dailyDistinctPayload(metric: string, values: number[]) {
  return {
    currentPeriod: values.map((v, i) => ({
      date: `2026-09-2${8 + i}`,
      [`0/${metric}/cardinality`]: v,
    })),
    previousPeriod: [],
    metric,
    aggregation: "cardinality",
  };
}

describe("given the CLI counted distinct ids per day", () => {
  beforeEach(preferReducedMotion);
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const renderDaily = (metric: string) =>
    renderCall(
      settledCall({
        name: "langwatch.analytics.query",
        resource: "analytics",
        verb: "query",
        payload: dailyDistinctPayload(metric, [3, 4]),
      }),
    );

  describe("when it counted traces", () => {
    /** @scenario A distinct count is added up only where each id falls once */
    it("totals the days, since each trace falls on one", () => {
      renderDaily("metadata.trace_id");

      expect(screen.getByText("7")).toBeTruthy();
    });
  });

  describe("when it counted users", () => {
    /** @scenario A distinct count is added up only where each id falls once */
    it("never totals the days, since a user can come back", () => {
      renderDaily("metadata.user_id");

      expect(screen.queryByText("7")).toBeNull();
      expect(screen.getByText(/spans several periods or groups, so it has no single/)).toBeTruthy();
    });
  });
});
