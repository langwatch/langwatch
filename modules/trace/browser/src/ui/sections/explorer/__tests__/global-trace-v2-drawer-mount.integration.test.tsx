// v2 drawer must mount on all trace-opening pages, including optimization
// studio (non-DashboardLayout).
// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let mockPathname = "/[project]/studio/[workflow]";

vi.mock("react-router", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  ...(await import("../../../../__tests__/window-location-router.ts")).windowLocationRouter,
}));

vi.mock("@langwatch/browser-host/use-router", () => ({
  useRouter: () => ({ pathname: mockPathname }),
}));

vi.mock("../hooks/use-trace-drawer-url-hydrator.ts", () => ({
  useTraceDrawerUrlHydrator: () => undefined,
}));

vi.mock("../trace-drawer/index.ts", () => ({
  TraceV2DrawerShell: () => <div data-testid="trace-v2-shell" />,
}));

import { setWindowAddress } from "../../../../__tests__/window-location-router.ts";
import { GlobalTraceV2DrawerMount } from "../global-trace-v2-drawer-mount.tsx";

const openTraceAddress = (traceId: string) =>
  setWindowAddress({
    url: `/my-project/simulations?drawer.open=traceV2Details&drawer.traceId=${traceId}`,
  });

describe("GlobalTraceV2DrawerMount", () => {
  beforeEach(() => {
    setWindowAddress({ url: "/my-project/simulations" });
  });

  afterEach(() => {
    cleanup();
  });

  describe("when a trace is open on the optimization studio page", () => {
    /** @scenario "The default applies to every trace entry point, not only the traces table" */
    it("renders the v2 drawer shell", () => {
      mockPathname = "/[project]/studio/[workflow]";
      openTraceAddress("trace-from-evaluations-panel");

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
      openTraceAddress("trace-on-traces-page");

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
      openTraceAddress("trace-on-traces-page");

      render(<GlobalTraceV2DrawerMount />);

      expect(screen.queryByTestId("trace-v2-shell")).not.toBeInTheDocument();
    });
  });

  describe("when a trace is open on a resolved path that is not the explorer", () => {
    /** @scenario "The trace drawer opens over a page that is not the Trace Explorer" */
    it("renders the v2 drawer shell", () => {
      mockPathname = "/my-project/simulations";
      openTraceAddress("trace-from-a-simulation");

      render(<GlobalTraceV2DrawerMount />);

      expect(screen.getByTestId("trace-v2-shell")).toBeInTheDocument();
    });
  });
});
