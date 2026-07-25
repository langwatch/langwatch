/**
 * @vitest-environment jsdom
 *
 * The card turns token counts into a dollar figure a customer will quote to
 * their finance team, so these render the real component tree against realistic
 * `getTimeseries` responses and check the number on screen, not the calc
 * module in isolation. The bucket keys are built from the series the card
 * actually requests, so the test follows a reordering of that request instead
 * of pinning it.
 *
 * Spec: specs/analytics/model-cost-comparison.feature
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";

import type { SeriesInputType } from "~/server/analytics/registry";
import { buildSeriesName } from "~/server/app-layer/analytics/repositories/_timeseries-row-parser";

import { ModelCostComparisonCard } from "../ModelCostComparisonCard";

// Anthropic Claude Sonnet 4.6's real catalog rates, the card's default
// reference model.
const SONNET_PRICING = {
  inputCostPerToken: 0.000003,
  outputCostPerToken: 0.000015,
  inputCacheReadPerToken: 0.0000003,
  inputCacheWritePerToken: 0.00000375,
};

const CACHED_PERIOD: Record<string, number> = {
  "performance.prompt_tokens": 2_000_000,
  "performance.completion_tokens": 500_000,
  "performance.cache_read_tokens": 1_000_000,
  "performance.cache_write_tokens": 200_000,
  "performance.total_cost": 0,
};

const EMPTY_PERIOD: Record<string, number> = {
  "performance.prompt_tokens": 0,
  "performance.completion_tokens": 0,
  "performance.cache_read_tokens": 0,
  "performance.cache_write_tokens": 0,
  "performance.total_cost": 0,
};

type TimeseriesInput = { series: SeriesInputType[] } & Record<string, unknown>;

const state: {
  values: Record<string, number> | undefined;
  isError: boolean;
  lastInput: TimeseriesInput | undefined;
  modelMetadata: Record<string, unknown>;
} = {
  values: undefined,
  isError: false,
  lastInput: undefined,
  modelMetadata: {},
};

/**
 * Encodes the values into a `currentPeriod` bucket exactly the way the
 * app-layer writes one, keyed off the series the card asked for.
 */
const bucketFor = (
  series: SeriesInputType[],
  values: Record<string, number>,
) => {
  const bucket: Record<string, unknown> = { date: "full" };
  series.forEach((entry, index) => {
    const value = values[entry.metric];
    if (value !== undefined) bucket[buildSeriesName(entry, index)] = value;
  });
  return bucket;
};

vi.mock("../../../hooks/useOrganizationTeamProject", () => ({
  useOrganizationTeamProject: () => ({
    project: { id: "proj-1", slug: "acme-app" },
    organization: { id: "org-1", name: "ACME" },
    team: { id: "team-1", name: "Platform" },
    hasPermission: () => true,
  }),
}));

vi.mock("~/utils/compat/next-router", () => ({
  useRouter: () => ({
    asPath: "/acme-app/analytics/metrics?labels=checkout",
    pathname: "/[project]/analytics/metrics",
    query: { project: "acme-app", period: "30d" },
    push: vi.fn(),
    replace: vi.fn(),
  }),
}));

vi.mock("../../../utils/api", () => ({
  api: {
    analytics: {
      getTimeseries: {
        useQuery: (input: TimeseriesInput) => {
          state.lastInput = input;
          if (state.isError) {
            return { data: undefined, isLoading: false, isError: true };
          }
          if (!state.values) {
            return { data: undefined, isLoading: true, isError: false };
          }
          return {
            data: {
              currentPeriod: [bucketFor(input.series, state.values)],
              previousPeriod: [],
            },
            isLoading: false,
            isError: false,
          };
        },
      },
    },
    modelProvider: {
      getAllForProjectForFrontend: {
        useQuery: () => ({
          data: { providers: {}, modelMetadata: state.modelMetadata },
          isLoading: false,
        }),
      },
      listAllForProjectForFrontend: {
        useQuery: () => ({
          data: {
            providers: [
              { provider: "anthropic", enabled: true, customModels: [] },
            ],
          },
          isLoading: false,
        }),
      },
    },
  },
}));

function renderCard() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <ChakraProvider value={defaultSystem}>
        <ModelCostComparisonCard />
      </ChakraProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  state.values = undefined;
  state.isError = false;
  state.lastInput = undefined;
  state.modelMetadata = {
    "anthropic/claude-sonnet-4-6": {
      id: "anthropic/claude-sonnet-4-6",
      name: "Claude Sonnet 4.6",
      provider: "anthropic",
      pricing: SONNET_PRICING,
    },
  };
});

afterEach(cleanup);

describe("<ModelCostComparisonCard />", () => {
  describe("given a period whose prompts were largely served from cache", () => {
    describe("when the card prices it against the reference model", () => {
      it("prices the cached tokens at the cache rates instead of ignoring them", () => {
        state.values = CACHED_PERIOD;
        renderCard();

        // 2M x $3/M + 500k x $15/M + 1M x $0.30/M + 200k x $3.75/M = $14.55.
        // Fresh input and output alone would be $13.50, so the cached tokens
        // moving the figure is what proves they were counted.
        expect(screen.getAllByText("$14.55").length).toBeGreaterThan(0);
        expect(screen.queryByText("$13.50")).not.toBeInTheDocument();
      });

      it("shows the token basis behind the estimate", () => {
        state.values = CACHED_PERIOD;
        renderCard();

        expect(
          screen.getByText(
            /Based on 2m input and 500k output tokens, plus 1\.2m cached/i,
          ),
        ).toBeInTheDocument();
      });

      it("requests the cached token counts alongside the fresh ones", () => {
        state.values = CACHED_PERIOD;
        renderCard();

        const metrics = state.lastInput?.series.map((s) => s.metric);
        expect(metrics).toEqual(
          expect.arrayContaining([
            "performance.prompt_tokens",
            "performance.completion_tokens",
            "performance.cache_read_tokens",
            "performance.cache_write_tokens",
            "performance.total_cost",
          ]),
        );
      });
    });
  });

  describe("given traffic that genuinely cost nothing", () => {
    it("shows $0.00 as the actual cost rather than claiming there is no data", () => {
      state.values = CACHED_PERIOD;
      renderCard();

      expect(screen.getByText("$0.00")).toBeInTheDocument();
      expect(screen.queryByText(/no data yet/i)).not.toBeInTheDocument();
    });
  });

  describe("given the page carries a filter", () => {
    it("passes it through to the usage query", () => {
      state.values = CACHED_PERIOD;
      renderCard();

      expect(state.lastInput?.filters).toMatchObject({
        "metadata.labels": ["checkout"],
      });
      expect(state.lastInput?.projectId).toBe("proj-1");
    });
  });

  describe("given no reference model with a published price", () => {
    it("explains why there is no estimate instead of showing $0.00 savings", () => {
      state.modelMetadata = {
        "custom/qwen3-14b": {
          id: "custom/qwen3-14b",
          name: "qwen3-14b",
          provider: "custom",
          pricing: { inputCostPerToken: 0, outputCostPerToken: 0 },
        },
      };
      state.values = CACHED_PERIOD;
      renderCard();

      expect(
        screen.getByText(/no model with a published price/i),
      ).toBeInTheDocument();
      expect(screen.queryByText("$0.00 ")).not.toBeInTheDocument();
    });
  });

  describe("given no traffic in the period", () => {
    it("shows an empty state instead of a $0.00 comparison", () => {
      state.values = EMPTY_PERIOD;
      renderCard();

      expect(screen.getByText(/no traffic in the selected period/i)).toBeInTheDocument();
      expect(screen.queryByText("$14.55")).not.toBeInTheDocument();
    });
  });

  describe("given the usage query has not resolved", () => {
    it("does not claim the period is empty before it has an answer", () => {
      state.values = undefined;
      renderCard();

      expect(
        screen.queryByText(/no traffic in the selected period/i),
      ).not.toBeInTheDocument();
      expect(screen.queryByText(/no data yet/i)).not.toBeInTheDocument();
    });
  });

  describe("given the usage query failed", () => {
    it("says so instead of reporting an empty period", () => {
      state.isError = true;
      renderCard();

      expect(screen.getByText(/could not load usage/i)).toBeInTheDocument();
      expect(
        screen.queryByText(/no traffic in the selected period/i),
      ).not.toBeInTheDocument();
    });
  });
});
