/**
 * @vitest-environment jsdom
 *
 * The v2 trace drawer shell must mount on every non-traces page that can
 * open a trace — including the optimization studio, which does not use
 * DashboardLayout and renders this mount itself. The shell is mocked: what
 * is under test is the mount/skip decision per route and drawer state.
 */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let mockPathname = "/[project]/studio/[workflow]";

vi.mock("~/utils/compat/next-router", () => ({
  useRouter: () => ({ pathname: mockPathname }),
}));

vi.mock("../../hooks/useTraceDrawerUrlHydrator", () => ({
  useTraceDrawerUrlHydrator: () => undefined,
}));

vi.mock("../TraceDrawer", () => ({
  TraceV2DrawerShell: () => <div data-testid="trace-v2-shell" />,
}));

import { useDrawerStore } from "../../stores/drawerStore";
import { GlobalTraceV2DrawerMount } from "../GlobalTraceV2DrawerMount";

describe("GlobalTraceV2DrawerMount", () => {
  beforeEach(() => {
    useDrawerStore.setState({ traceId: null });
  });

  afterEach(() => {
    cleanup();
  });

  describe("when a trace is open on the optimization studio page", () => {
    /** @scenario The new explorer renders on the optimization studio page */
    it("renders the v2 drawer shell", () => {
      mockPathname = "/[project]/studio/[workflow]";
      useDrawerStore.getState().openTrace("trace-from-evaluations-panel");

      render(<GlobalTraceV2DrawerMount />);

      expect(screen.getByTestId("trace-v2-shell")).toBeInTheDocument();
    });
  });

  describe("when no trace is open", () => {
    it("renders nothing", () => {
      mockPathname = "/[project]/studio/[workflow]";

      render(<GlobalTraceV2DrawerMount />);

      expect(screen.queryByTestId("trace-v2-shell")).not.toBeInTheDocument();
    });
  });

  describe("when on the traces page that mounts its own shell", () => {
    it("skips mounting to avoid a double shell", () => {
      mockPathname = "/[project]/traces";
      useDrawerStore.getState().openTrace("trace-on-traces-page");

      render(<GlobalTraceV2DrawerMount />);

      expect(screen.queryByTestId("trace-v2-shell")).not.toBeInTheDocument();
    });
  });
});
