/**
 * @vitest-environment jsdom
 *
 * @see specs/suites/simulations-performance.feature — "A quiet set does not
 * re-download its run history" / "Active sets refresh faster than idle sets"
 */
import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ScenarioRunStatus } from "~/server/scenarios/scenario-event.enums";
import { useSuiteRunFreshness } from "../useSuiteRunFreshness";

const mocks = vi.hoisted(() => ({
  invalidate: vi.fn(),
  useQuery: vi.fn(),
}));

vi.mock("~/utils/api", () => ({
  api: {
    useContext: () => ({
      scenarios: { getSuiteRunData: { invalidate: mocks.invalidate } },
    }),
    scenarios: { getSuiteRunFreshness: { useQuery: mocks.useQuery } },
  },
}));

vi.mock("~/hooks/useOrganizationTeamProject", () => ({
  useOrganizationTeamProject: () => ({ project: { id: "project-1" } }),
}));

const settledRun = { status: ScenarioRunStatus.SUCCESS };
const activeRun = { status: ScenarioRunStatus.IN_PROGRESS };

function renderFreshness({
  lastUpdatedAt,
  runs = [settledRun],
  sseConnected = false,
}: {
  lastUpdatedAt: number | undefined;
  runs?: { status: ScenarioRunStatus }[];
  sseConnected?: boolean;
}) {
  mocks.useQuery.mockReturnValue({
    data: lastUpdatedAt === undefined ? undefined : { lastUpdatedAt },
  });
  return renderHook(
    (props: { lastUpdatedAt: number | undefined }) => {
      mocks.useQuery.mockReturnValue({
        data:
          props.lastUpdatedAt === undefined
            ? undefined
            : { lastUpdatedAt: props.lastUpdatedAt },
      });
      return useSuiteRunFreshness({
        startDateMs: 1000,
        runs,
        enabled: true,
        sseConnected,
      });
    },
    { initialProps: { lastUpdatedAt } },
  );
}

describe("useSuiteRunFreshness()", () => {
  beforeEach(() => {
    mocks.invalidate.mockClear();
    mocks.useQuery.mockClear();
  });

  describe("given the first freshness observation", () => {
    it("does not invalidate the run data", () => {
      renderFreshness({ lastUpdatedAt: 500 });
      expect(mocks.invalidate).not.toHaveBeenCalled();
    });
  });

  describe("given freshness advances past the last observed value", () => {
    it("invalidates the heavy run data query", () => {
      const { rerender } = renderFreshness({ lastUpdatedAt: 500 });
      rerender({ lastUpdatedAt: 900 });
      expect(mocks.invalidate).toHaveBeenCalledTimes(1);
    });
  });

  describe("given freshness stays the same", () => {
    it("does not invalidate the run data", () => {
      const { rerender } = renderFreshness({ lastUpdatedAt: 500 });
      rerender({ lastUpdatedAt: 500 });
      expect(mocks.invalidate).not.toHaveBeenCalled();
    });
  });

  describe("polling cadence", () => {
    it("stops polling while the event stream is connected", () => {
      renderFreshness({ lastUpdatedAt: 500, sseConnected: true });
      const options = mocks.useQuery.mock.calls.at(-1)?.[1];
      expect(options.refetchInterval).toBe(false);
    });

    it("polls fast while runs are executing", () => {
      renderFreshness({ lastUpdatedAt: 500, runs: [activeRun] });
      const options = mocks.useQuery.mock.calls.at(-1)?.[1];
      expect(options.refetchInterval).toBe(3000);
    });

    it("polls slowly when all runs have settled", () => {
      renderFreshness({ lastUpdatedAt: 500, runs: [settledRun] });
      const options = mocks.useQuery.mock.calls.at(-1)?.[1];
      expect(options.refetchInterval).toBe(15000);
    });
  });
});
