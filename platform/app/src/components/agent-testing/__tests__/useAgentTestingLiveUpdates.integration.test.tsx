// @vitest-environment jsdom
/**
 * The live-run subscription of the Agent Testing page refreshes the reads
 * the page holds. The results reads are among them: with the stream
 * connected the results page does not poll, so the update the evaluators
 * send after a run finished is what fills the evaluator pills in.
 *
 * @see specs/features/agent-testing/results-tabs.feature
 */
import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const listenerOptions = vi.hoisted(
  () => ({}) as { refetch?: () => void; enabled?: boolean },
);
const invalidations = vi.hoisted(() => ({
  suiteSummaries: vi.fn(),
  externalSetSummaries: vi.fn(),
  batchRunCount: vi.fn(),
  resultsOverview: vi.fn(),
  resultAtoms: vi.fn(),
}));

vi.mock("~/hooks/useSimulationUpdateListener", () => ({
  useSimulationUpdateListener: (options: {
    refetch: () => void;
    enabled: boolean;
  }) => {
    listenerOptions.refetch = options.refetch;
    listenerOptions.enabled = options.enabled;
    return { isConnected: true };
  },
}));
vi.mock("~/hooks/useScenarioTabFollow", () => ({
  useScenarioTabFollow: () => ({ tabKey: "tab", tabId: "tab_1" }),
}));
vi.mock("~/utils/compat/next-router", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));
vi.mock("~/utils/api", () => ({
  api: {
    useUtils: () => ({
      suites: { getSummaries: { invalidate: invalidations.suiteSummaries } },
      scenarios: {
        getExternalSetSummaries: {
          invalidate: invalidations.externalSetSummaries,
        },
        getScenarioSetBatchRunCount: {
          invalidate: invalidations.batchRunCount,
        },
        getResultsOverview: { invalidate: invalidations.resultsOverview },
        getResultAtoms: { invalidate: invalidations.resultAtoms },
      },
    }),
  },
}));

import { useAgentTestingLiveUpdates } from "../useAgentTestingLiveUpdates";

describe("the Agent Testing live updates", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("when a simulation update arrives", () => {
    /** @scenario "A simulation update makes the results read again" */
    it("reads the results overview and the result atoms again", () => {
      const { result } = renderHook(() =>
        useAgentTestingLiveUpdates("project_1"),
      );
      expect(result.current.isSseConnected).toBe(true);
      expect(listenerOptions.enabled).toBe(true);

      listenerOptions.refetch?.();

      expect(invalidations.resultsOverview).toHaveBeenCalledTimes(1);
      expect(invalidations.resultAtoms).toHaveBeenCalledTimes(1);
      expect(invalidations.suiteSummaries).toHaveBeenCalledTimes(1);
      expect(invalidations.batchRunCount).toHaveBeenCalledTimes(1);
    });
  });
});
