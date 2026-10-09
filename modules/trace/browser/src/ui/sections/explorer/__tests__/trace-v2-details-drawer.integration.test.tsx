// The trace drawer is the routed singleton: the address opens it on every page through
// the installed registry, and a share page, which draws the trace in place, gets none.
// @vitest-environment jsdom
import { CurrentDrawer } from "@langwatch/browser-host/drawer";
import { installedModuleDrawers } from "@langwatch/browser/module-drawers";
import { renderWithDesignSystem } from "@langwatch/design-system/testing";
import { act, cleanup, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";

vi.mock("react-router", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  ...(await import("../../../../__tests__/window-location-router.ts")).windowLocationRouter,
}));

// The page's route reading, which the shell's route host answers in the application.
vi.mock("@langwatch/browser-host/use-router", () => ({
  useRouter: () => ({ pathname: window.location.pathname }),
}));

vi.mock("../../../../features/trace-drawer/behavior/use-trace-drawer-url-hydrator.ts", () => ({
  useTraceDrawerUrlHydrator: () => undefined,
}));

const shellModule = vi.hoisted(() => ({ loads: 0 }));

vi.mock("../trace-drawer/index.ts", () => {
  shellModule.loads += 1;
  return { TraceV2DrawerShell: () => <div data-testid="trace-v2-shell" /> };
});

import { setWindowAddress } from "../../../../__tests__/window-location-router.ts";
import { traceWeb } from "../../../../trace.web.ts";

const drawers = installedModuleDrawers([traceWeb]);

const openTraceOn = ({ path, traceId }: { path: string; traceId: string }) =>
  setWindowAddress({ url: `${path}?drawer.open=traceV2Details&drawer.traceId=${traceId}` });

/** The installed drawer, loaded before the page renders, so an absence is an answer. */
async function renderDrawerHost() {
  await traceWeb.installation.drawers.traceV2Details?.load();
  const view = renderWithDesignSystem(<CurrentDrawer drawers={drawers} />);
  await act(async () => undefined);
  return view;
}

afterEach(() => {
  cleanup();
  setWindowAddress({ url: "/" });
});

describe("the declared trace drawer", () => {
  // Runs first: the module registry is per file, so a later test would have loaded it.
  describe("when no trace has opened on the page yet", () => {
    /** @scenario "A page loads the trace drawer only when a trace opens" */
    it("does not load the drawer's code", async () => {
      setWindowAddress({ url: "/my-project/dashboards" });

      renderWithDesignSystem(<CurrentDrawer drawers={drawers} />);
      await act(async () => undefined);

      expect(shellModule.loads).toBe(0);
    });
  });

  describe("when a trace is open on the optimization studio page", () => {
    /** @scenario "The default applies to every trace entry point, not only the traces table" */
    it("renders the v2 drawer shell", async () => {
      openTraceOn({ path: "/my-project/studio/workflow-1", traceId: "trace-from-studio" });

      await renderDrawerHost();

      expect(await screen.findByTestId("trace-v2-shell")).toBeInTheDocument();
    });
  });

  describe("when a trace is open on a page that is not the explorer", () => {
    /** @scenario "The trace drawer opens over a page that is not the Trace Explorer" */
    it("renders the v2 drawer shell over that page", async () => {
      openTraceOn({ path: "/my-project/simulations", traceId: "trace-from-a-simulation" });

      await renderDrawerHost();

      expect(await screen.findByTestId("trace-v2-shell")).toBeInTheDocument();
      expect(window.location.pathname).toBe("/my-project/simulations");
    });
  });

  describe("when a trace is open on the Trace Explorer", () => {
    /** @scenario "The Trace Explorer gets the one routed trace drawer" */
    it("puts exactly one trace drawer on screen", async () => {
      openTraceOn({ path: "/my-project/traces", traceId: "trace-on-traces-page" });

      await renderDrawerHost();

      expect(await screen.findAllByTestId("trace-v2-shell")).toHaveLength(1);
    });
  });

  describe("when the drawer address names no trace", () => {
    it("renders nothing", async () => {
      setWindowAddress({ url: "/my-project/simulations?drawer.open=traceV2Details" });

      await renderDrawerHost();

      expect(screen.queryByTestId("trace-v2-shell")).not.toBeInTheDocument();
    });
  });

  describe("when a share page borrows the address", () => {
    it("draws nothing over the page", async () => {
      openTraceOn({ path: "/share/share-token-1", traceId: "trace-shared" });

      await renderDrawerHost();

      expect(screen.queryByTestId("trace-v2-shell")).not.toBeInTheDocument();
      expect(window.location.search).toContain("drawer.open=traceV2Details");
    });
  });
});
