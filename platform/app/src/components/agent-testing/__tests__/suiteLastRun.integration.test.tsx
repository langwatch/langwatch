/**
 * @vitest-environment jsdom
 *
 * "Open last run" in the suites rail: which run it opens, and under which run
 * plan.
 *
 * @see specs/features/agent-testing/suites-rail.feature
 */
import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { TestSuiteEntry } from "../cases/test-cases";
import { useOpenSuiteLastRun } from "../cases/useOpenSuiteLastRun";
import type { SuiteLastRun } from "../cases/useTestCasesData";

const routerPush = vi.hoisted(() => vi.fn());

vi.mock("~/utils/compat/next-router", () => ({
  useRouter: () => ({
    query: { project: "test-project" },
    push: routerPush,
    isReady: true,
  }),
}));

const REFUNDS: TestSuiteEntry = {
  id: "suite_refunds",
  name: "Refunds",
  slug: "refunds",
  caseCount: 2,
};

/** The plan a run of one scenario made for itself. */
const DOUBLE_CHARGE: TestSuiteEntry = {
  id: "suite_double_charge",
  name: "Double charge ACME Support Agent",
  slug: "double-charge-acme-support-agent",
  caseCount: 1,
};

function openLastRun({
  lastRun,
  suites = [REFUNDS, DOUBLE_CHARGE],
}: {
  lastRun?: SuiteLastRun;
  suites?: TestSuiteEntry[];
}) {
  const lastRunBySuiteId = new Map<string, SuiteLastRun>(
    lastRun ? [[REFUNDS.id, lastRun]] : [],
  );
  const { result } = renderHook(() =>
    useOpenSuiteLastRun({ suites, lastRunBySuiteId }),
  );
  result.current(REFUNDS);
}

describe("given a suite whose scenarios ran", () => {
  /** @scenario "Open last run goes straight to the last run of that suite" */
  it("opens that run under the plan named after the suite", () => {
    routerPush.mockClear();

    openLastRun({
      lastRun: {
        batchRunId: "batch_9",
        scenarioSetId: "__internal__suite_refunds__suite",
        lastRunAt: 3,
      },
    });

    expect(routerPush).toHaveBeenCalledWith(
      expect.anything(),
      "/test-project/agent-testing/results/refunds/batch_9",
      { shallow: true },
    );
  });

  /** @scenario "Open last run opens the newest run of any scenario of the suite" */
  it("opens a run of one scenario under the plan that run made for itself", () => {
    routerPush.mockClear();

    openLastRun({
      lastRun: {
        batchRunId: "batch_alone",
        scenarioSetId: "__internal__suite_double_charge__suite",
        lastRunAt: 5,
      },
    });

    expect(routerPush).toHaveBeenCalledWith(
      expect.anything(),
      "/test-project/agent-testing/results/double-charge-acme-support-agent/batch_alone",
      { shallow: true },
    );
  });
});

describe("given a suite with no run inside the period", () => {
  /** @scenario "Open last run is not offered for a suite that never ran" */
  it("opens nothing", () => {
    routerPush.mockClear();

    openLastRun({});

    expect(routerPush).not.toHaveBeenCalled();
  });
});
