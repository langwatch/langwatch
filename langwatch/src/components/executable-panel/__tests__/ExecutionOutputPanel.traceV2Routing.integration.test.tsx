/**
 * @vitest-environment jsdom
 *
 * Integration test for the workflow execution panel's "Full Trace" button.
 * Renders the real component and clicks the real button so the test guards
 * against the button ever re-bypassing the central traces-v2 opt-in routing.
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { push, replace } = vi.hoisted(() => ({
  push: vi.fn(),
  replace: vi.fn(),
}));

vi.mock("~/utils/compat/next-router", () => {
  const router = {
    query: {},
    asPath: "/test-project/workflows/wf-1",
    push,
    replace,
  };
  return { default: router, useRouter: () => router };
});

import type { ExecutionState } from "~/optimization_studio/types/dsl";
import { setTracesV2Preferred } from "../../../features/traces-v2/hooks/useTracesV2Preference";
import { ExecutionOutputPanel } from "../ExecutionOutputPanel";

const Wrapper = ({ children }: { children: React.ReactNode }) => (
  <ChakraProvider value={defaultSystem}>{children}</ChakraProvider>
);

const completedExecution = {
  status: "success",
  trace_id: "trace-wf-7",
  cost: 0.0012,
  timestamps: { started_at: 1000, finished_at: 4500 },
  outputs: {},
} as unknown as ExecutionState;

describe("ExecutionOutputPanel Full Trace button", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.clear();
  });

  afterEach(() => {
    cleanup();
  });

  describe("when the device has opted into traces v2", () => {
    /** @scenario "Viewing the full trace from a workflow run honors the opt-in" */
    it("opens the new explorer drawer for the run's trace", async () => {
      setTracesV2Preferred(true);
      const user = userEvent.setup();

      render(
        <ExecutionOutputPanel
          executionState={completedExecution}
          isTracingEnabled
        />,
        { wrapper: Wrapper },
      );

      await user.click(screen.getByRole("button", { name: /full trace/i }));

      expect(push).toHaveBeenCalled();
      const url = String(push.mock.calls[0]?.[0]);
      expect(url).toMatch(/drawer\.open=traceV2Details/);
      expect(url).toContain("trace-wf-7");
    });
  });

  describe("when the device has not opted into traces v2", () => {
    it("opens the legacy drawer for the run's trace", async () => {
      const user = userEvent.setup();

      render(
        <ExecutionOutputPanel
          executionState={completedExecution}
          isTracingEnabled
        />,
        { wrapper: Wrapper },
      );

      await user.click(screen.getByRole("button", { name: /full trace/i }));

      expect(push).toHaveBeenCalled();
      const url = String(push.mock.calls[0]?.[0]);
      expect(url).toMatch(/drawer\.open=traceDetails/);
      expect(url).toContain("trace-wf-7");
    });
  });
});
