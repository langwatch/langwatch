/**
 * @vitest-environment jsdom
 *
 * Where a queued run lands: a run of several scenarios opens the Results tab
 * on the plan and the run it started, and a run of one scenario opens in the
 * run drawer.
 *
 * @see specs/features/agent-testing/run-dialog.feature
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useRunStartedHandler } from "../cases/useCaseRunActions";
import type { RunStartedInfo } from "../run/run-dialog-types";
import { useAgentTestingStore } from "../useAgentTestingStore";

const mockRouterPush = vi.hoisted(() => vi.fn());
const mockOpenDrawer = vi.hoisted(() => vi.fn());
const mockToast = vi.hoisted(() => vi.fn());

vi.mock("~/utils/compat/next-router", () => ({
  useRouter: () => ({
    query: { project: "test-project" },
    asPath: "/test-project/agent-testing",
    push: mockRouterPush,
    isReady: true,
  }),
}));

vi.mock("~/hooks/useDrawer", () => ({
  useDrawer: () => ({ openDrawer: mockOpenDrawer }),
}));

vi.mock("~/components/ui/toaster", () => ({
  toaster: { create: mockToast },
}));

const Wrapper = ({ children }: { children: React.ReactNode }) => (
  <ChakraProvider value={defaultSystem}>{children}</ChakraProvider>
);

/** A button that reports one run as started, the way the run dialog does. */
function StartRun({ info }: { info: RunStartedInfo }) {
  const onRunStarted = useRunStartedHandler();
  return (
    <button type="button" onClick={() => onRunStarted(info)}>
      Start
    </button>
  );
}

const SUITE_RUN: RunStartedInfo = {
  batchRunId: "batch_new",
  scenarioSetId: "__internal__plan_1__suite",
  planSlug: "refunds-prod-agent",
};

describe("where a queued run lands", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAgentTestingStore.setState({ pendingRun: null });
  });

  afterEach(cleanup);

  describe("given a run of several scenarios was queued", () => {
    /** @scenario "A run of several scenarios opens the results of the run it started" */
    it("opens the Results tab on the plan and the run, with no toast", async () => {
      const user = userEvent.setup();
      render(<StartRun info={SUITE_RUN} />, { wrapper: Wrapper });

      await user.click(screen.getByRole("button", { name: "Start" }));

      expect(mockRouterPush).toHaveBeenCalledTimes(1);
      const [route, address] = mockRouterPush.mock.calls[0]!;
      expect(address).toBe(
        "/test-project/agent-testing/results/refunds-prod-agent/batch_new",
      );
      expect(route).toMatchObject({
        query: {
          project: "test-project",
          path: ["results", "refunds-prod-agent", "batch_new"],
        },
      });
      expect(mockToast).not.toHaveBeenCalled();
      expect(mockOpenDrawer).not.toHaveBeenCalled();
      expect(useAgentTestingStore.getState().pendingRun).toEqual({
        batchRunId: "batch_new",
        scenarioSetId: "__internal__plan_1__suite",
      });
    });
  });

  describe("given a run of one scenario was queued", () => {
    /** @scenario "A run of one scenario opens in the run drawer" */
    it("opens the run drawer on that scenario and stays on the page", async () => {
      const user = userEvent.setup();
      render(
        <StartRun
          info={{ ...SUITE_RUN, scenarioId: "case_1", targetId: "agent_1" }}
        />,
        { wrapper: Wrapper },
      );

      await user.click(screen.getByRole("button", { name: "Start" }));

      expect(mockOpenDrawer).toHaveBeenCalledWith("scenarioRunDetail", {
        urlParams: {
          variant: "agent-testing",
          batchRunId: "batch_new",
          scenarioSetId: "__internal__plan_1__suite",
          scenarioId: "case_1",
          targetId: "agent_1",
        },
      });
      expect(mockRouterPush).not.toHaveBeenCalled();
      expect(mockToast).not.toHaveBeenCalled();
    });
  });
});
