/**
 * @vitest-environment jsdom
 *
 * The address holds the whole state of the Agent Testing page, and every move
 * inside the page is a shallow push into the one catch-all route, so the page
 * never remounts.
 *
 * @see specs/features/agent-testing/page-structure.feature
 */
import { cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const router = vi.hoisted(() => ({
  isReady: true,
  asPath: "/demo/agent-testing",
  query: {} as Record<string, string | string[] | undefined>,
  push: vi.fn(),
}));

vi.mock("../../next-router", () => ({
  useRouter: () => router,
}));

import { useAgentTestingRouting } from "../use-agent-testing-routing";

const openAt = (asPath: string, query: Record<string, string | string[] | undefined> = {}) => {
  router.asPath = asPath;
  router.query = { project: "demo", ...query };
};

/** The three arguments of the last push: route, address, options. */
const lastPush = () => {
  const call = router.push.mock.calls.at(-1);
  if (!call) throw new Error("nothing was pushed");
  return {
    route: call[0] as { pathname: string; query: Record<string, unknown> },
    address: call[1] as string,
    options: call[2] as { shallow: boolean },
  };
};

describe("useAgentTestingRouting", () => {
  beforeEach(() => {
    router.push.mockClear();
    router.isReady = true;
    openAt("/demo/agent-testing");
  });

  afterEach(cleanup);

  describe("given the page address", () => {
    /** @scenario "An address that names no suite opens the first suite of the rail" */
    it("opens on the Scenarios tab naming no suite, so the first one is opened", () => {
      const { result } = renderHook(() => useAgentTestingRouting());

      expect(result.current.tab).toBe("cases");
      expect(result.current.selection).toEqual({ kind: "suite", slug: null });
    });

    it("writes the bare address back for a state that names no suite", () => {
      const { result } = renderHook(() => useAgentTestingRouting());

      result.current.selectSuite({ kind: "suite", slug: null });

      expect(lastPush().address).toBe("/demo/agent-testing");
    });

    /** @scenario "The selected tab, suite and period are held in the address" */
    it("reads back the suite the address names", () => {
      openAt("/demo/agent-testing/suites/checkout", {
        path: ["suites", "checkout"],
      });

      const { result } = renderHook(() => useAgentTestingRouting());

      expect(result.current.tab).toBe("cases");
      expect(result.current.selection).toEqual({
        kind: "suite",
        slug: "checkout",
      });
    });

    it("reads back the plan and the run the address names", () => {
      openAt("/demo/agent-testing/results/nightly/batch-1", {
        path: ["results", "nightly", "batch-1"],
      });

      const { result } = renderHook(() => useAgentTestingRouting());

      expect(result.current.tab).toBe("results");
      expect(result.current.planSlug).toBe("nightly");
      expect(result.current.batchRunId).toBe("batch-1");
    });

    it("holds its state until the router reports the address", () => {
      router.isReady = false;
      openAt("/demo/agent-testing/suites/checkout", {
        path: ["suites", "checkout"],
      });

      const { result } = renderHook(() => useAgentTestingRouting());

      expect(result.current.isReady).toBe(false);
    });
  });

  describe("when a suite is chosen", () => {
    /** @scenario "The selected tab, suite and period are held in the address" */
    it("names the suite in the address", () => {
      const { result } = renderHook(() => useAgentTestingRouting());

      result.current.selectSuite({ kind: "suite", slug: "checkout" });

      expect(lastPush().address).toBe("/demo/agent-testing/suites/checkout");
      expect(lastPush().route.pathname).toBe("/[project]/agent-testing/[[...path]]");
    });

    /** @scenario "The selected tab, suite and period are held in the address" */
    it("keeps the period a person picked", () => {
      openAt("/demo/agent-testing?period=90d", { period: "90d" });
      const { result } = renderHook(() => useAgentTestingRouting());

      result.current.selectSuite({ kind: "suite", slug: "checkout" });

      expect(lastPush().address).toBe("/demo/agent-testing/suites/checkout?period=90d");
    });

    it("leaves an open drawer behind", () => {
      openAt("/demo/agent-testing", {
        "drawer.open": "scenarioRunDetail",
        "drawer.scenarioRunId": "run-1",
      });
      const { result } = renderHook(() => useAgentTestingRouting());

      result.current.selectSuite({ kind: "suite", slug: "checkout" });

      expect(lastPush().address).toBe("/demo/agent-testing/suites/checkout");
    });

    it("moves without a page transition", () => {
      const { result } = renderHook(() => useAgentTestingRouting());

      result.current.selectSuite({ kind: "suite", slug: "checkout" });

      expect(lastPush().options).toEqual({ shallow: true });
    });
  });

  describe("when the tab is changed", () => {
    it("opens the Results tab on its own address", () => {
      const { result } = renderHook(() => useAgentTestingRouting());

      result.current.setTab("results");

      expect(lastPush().address).toBe("/demo/agent-testing/results");
    });

    it("drops the plan and the run the Results tab held", () => {
      openAt("/demo/agent-testing/results/nightly/batch-1", {
        path: ["results", "nightly", "batch-1"],
      });
      const { result } = renderHook(() => useAgentTestingRouting());

      result.current.setTab("cases");

      expect(lastPush().address).toBe("/demo/agent-testing");
    });
  });

  describe("when a run is chosen", () => {
    it("names the plan and the run in the address", () => {
      openAt("/demo/agent-testing/results/nightly", {
        path: ["results", "nightly"],
      });
      const { result } = renderHook(() => useAgentTestingRouting());

      result.current.selectRun("batch-2");

      expect(lastPush().address).toBe("/demo/agent-testing/results/nightly/batch-2");
    });
  });

  describe("when a run of another plan is chosen from the list", () => {
    /** @scenario "Choosing a run inside an opened row lands on its plan at that run" */
    it("names that plan and that run in one address change", () => {
      openAt("/demo/agent-testing/results", { path: ["results"] });
      const { result } = renderHook(() => useAgentTestingRouting());

      result.current.selectPlanRun({
        planSlug: "nightly",
        batchRunId: "batch-2",
      });

      expect(lastPush().address).toBe("/demo/agent-testing/results/nightly/batch-2");
    });
  });
});
