/**
 * @vitest-environment jsdom
 *
 * The freshness probe of the run history polls on its own only while the live stream is down.
 * @see specs/features/suites/real-time-run-updates.feature
 */
import { ScenarioRunStatus } from "@langwatch/scenario-contract";
import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { makeScenarioRunData } from "./run-history-fixtures.ts";

const state = vi.hoisted(() => ({
  runs: [] as unknown[],
  freshnessOptions: undefined as { refetchInterval?: number | false } | undefined,
}));

vi.mock("@langwatch/scenario-client", () => ({
  scenarioClient: {
    useUtils: () => ({ scenarios: { getSuiteRunData: { invalidate: vi.fn() } } }),
    scenarios: {
      getSuiteRunData: {
        useInfiniteQuery: () => ({
          data: {
            pages: [
              {
                changed: true,
                lastUpdatedAt: 1,
                runs: state.runs,
                scenarioSetIds: {},
                hasMore: false,
              },
            ],
          },
          isLoading: false,
          error: null,
          refetch: vi.fn(),
          hasNextPage: false,
          isFetchingNextPage: false,
          fetchNextPage: vi.fn(),
        }),
      },
      getSuiteRunFreshness: {
        useQuery: (_input: unknown, options: { refetchInterval?: number | false }) => {
          state.freshnessOptions = options;
          return { data: undefined };
        },
      },
    },
  },
}));
vi.mock("@langwatch/browser-host/use-organization-team-project", () => ({
  useOrganizationTeamProject: () => ({ project: { id: "proj_1" } }),
}));

import { useRunHistoryPagination } from "../use-run-history-pagination.ts";

const run = (id: string, status: ScenarioRunStatus) =>
  makeScenarioRunData({ scenarioRunId: id, status });

function interval({
  scenarioSetId,
  sseConnected,
  adaptivePolling = true,
}: {
  scenarioSetId?: string;
  sseConnected?: boolean;
  adaptivePolling?: boolean;
}) {
  renderHook(() =>
    useRunHistoryPagination({ scenarioSetId, startDateMs: 100, sseConnected, adaptivePolling }),
  );
  return state.freshnessOptions?.refetchInterval;
}

describe("useRunHistoryPagination() freshness polling", () => {
  beforeEach(() => {
    state.runs = [];
    state.freshnessOptions = undefined;
  });

  describe("given the All Runs data holds at least one PENDING or IN_PROGRESS row", () => {
    /** @scenario All Runs polling interval is fast when any run is active */
    it("polls between 2 and 3 seconds", () => {
      state.runs = [run("a", ScenarioRunStatus.SUCCESS), run("b", ScenarioRunStatus.IN_PROGRESS)];

      const polled = interval({});

      expect(polled).toBeGreaterThanOrEqual(2_000);
      expect(polled).toBeLessThanOrEqual(3_000);
    });
  });

  describe("given the All Runs data holds only settled rows", () => {
    /** @scenario All Runs polling interval is slow when all runs are settled */
    it("polls between 15 and 30 seconds", () => {
      state.runs = [run("a", ScenarioRunStatus.SUCCESS), run("b", ScenarioRunStatus.FAILED)];

      const polled = interval({});

      expect(polled).toBeGreaterThanOrEqual(15_000);
      expect(polled).toBeLessThanOrEqual(30_000);
    });
  });

  describe("given the runs of one suite", () => {
    it("follows its rows from slow to fast when one starts", () => {
      state.runs = [run("a", ScenarioRunStatus.SUCCESS)];
      const { rerender } = renderHook(() =>
        useRunHistoryPagination({
          scenarioSetId: "set_1",
          startDateMs: 100,
          adaptivePolling: true,
        }),
      );
      expect(state.freshnessOptions?.refetchInterval).toBeGreaterThanOrEqual(15_000);

      state.runs = [run("a", ScenarioRunStatus.SUCCESS), run("b", ScenarioRunStatus.IN_PROGRESS)];
      rerender();

      expect(state.freshnessOptions?.refetchInterval).toBeLessThanOrEqual(3_000);
    });
  });

  describe("given the live stream is connected", () => {
    it("sets no timer, whatever the rows hold", () => {
      state.runs = [run("a", ScenarioRunStatus.IN_PROGRESS)];

      interval({ sseConnected: true });

      expect(state.freshnessOptions).not.toHaveProperty("refetchInterval");
    });
  });

  describe("given a caller that does not ask for adaptive polling (the Agent Testing results)", () => {
    it("sets no timer, whatever the rows hold", () => {
      state.runs = [run("a", ScenarioRunStatus.IN_PROGRESS)];

      interval({ adaptivePolling: false });

      expect(state.freshnessOptions).not.toHaveProperty("refetchInterval");
    });
  });
});
