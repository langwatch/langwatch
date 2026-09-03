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

vi.mock("../../../../behavior/next-router", () => ({
  useRouter: () => ({ pathname: mockPathname }),
}));

vi.mock("../hooks/use-trace-drawer-url-hydrator", () => ({
  useTraceDrawerUrlHydrator: () => undefined,
}));

vi.mock("../trace-drawer", () => ({
  TraceV2DrawerShell: () => <div data-testid="trace-v2-shell" />,
}));

import { useDrawerStore } from "../../../../index";
import { GlobalTraceV2DrawerMount } from "../global-trace-v2-drawer-mount";

describe("GlobalTraceV2DrawerMount", () => {
  beforeEach(() => {
    useDrawerStore.setState({ traceId: null });
  });

  afterEach(() => {
    cleanup();
  });

  describe("when a trace is open on the optimization studio page", () => {
    /** @scenario "The default applies to every trace entry point, not only the traces table" */
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

    /**
     * The host that answers `pathname` decides which spelling arrives.
     * `platform/app` handed over Next's dynamic-route TEMPLATE; `apps/ui`
     * hands over react-router's RESOLVED path, and a check that only knows the
     * template reads the explorer as somewhere else — which is the one answer
     * that puts two drawers over one trace.
     */
    /** @scenario "The Trace Explorer is left to draw its own drawer" */
    it("skips it under the resolved project path too", () => {
      mockPathname = "/my-project/traces";
      useDrawerStore.getState().openTrace("trace-on-traces-page");

      render(<GlobalTraceV2DrawerMount />);

      expect(screen.queryByTestId("trace-v2-shell")).not.toBeInTheDocument();
    });
  });

  describe("when a trace is open on a resolved path that is not the explorer", () => {
    /** @scenario "The trace drawer opens over a page that is not the Trace Explorer" */
    it("renders the v2 drawer shell", () => {
      mockPathname = "/my-project/simulations";
      useDrawerStore.getState().openTrace("trace-from-a-simulation");

      render(<GlobalTraceV2DrawerMount />);

      expect(screen.getByTestId("trace-v2-shell")).toBeInTheDocument();
    });
  });
});
