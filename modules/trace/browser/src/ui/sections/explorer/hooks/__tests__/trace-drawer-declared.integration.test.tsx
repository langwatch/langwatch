// The trace drawer's openers go through the real drawer navigator under the installed
// registry, which refuses an undeclared name: each must open the drawer trace declares.
// @vitest-environment jsdom
import { CurrentDrawer } from "@langwatch/browser-host/drawer";
import { installedModuleDrawers } from "@langwatch/browser/module-drawers";
import { renderWithDesignSystem } from "@langwatch/design-system/testing";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";

vi.mock("react-router", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  ...(await import("../../../../../__tests__/window-location-router.ts")).windowLocationRouter,
}));

vi.mock("../../../../../behavior/use-organization-team-project.ts", () => ({
  useOrganizationTeamProject: () => ({ project: undefined }),
}));

vi.mock("../../../../../behavior/trace-api.ts", () => ({ api: { useUtils: () => ({}) } }));

vi.mock("../../trace-drawer/index.ts", () => ({
  TraceV2DrawerShell: () => <div data-testid="trace-v2-shell" />,
}));

import { setWindowAddress } from "../../../../../__tests__/window-location-router.ts";
import { drawerChrome } from "../../../../../behavior/drawer-chrome.store.ts";
import { useTraceEditStore } from "../../../../../behavior/trace-edit.store.ts";
import { traceWeb } from "../../../../../trace.web.ts";
import type { TraceListItem } from "../../types/trace.ts";
import { useOpenTraceDrawer } from "../use-open-trace-drawer.ts";

const PAGE = "/my-project/simulations";
const TRACE = "trace-1";

function OpenTraceButton({ trace }: { trace: TraceListItem }) {
  const openTrace = useOpenTraceDrawer();
  return <button onClick={() => openTrace(trace)}>open trace</button>;
}

async function renderPageWithDrawerHost({ trace }: { trace?: TraceListItem } = {}) {
  await traceWeb.installation.drawers.traceV2Details?.load();
  const queryClient = new QueryClient();
  renderWithDesignSystem(
    <QueryClientProvider client={queryClient}>
      {trace ? <OpenTraceButton trace={trace} /> : null}
      <CurrentDrawer drawers={installedModuleDrawers([traceWeb])} />
    </QueryClientProvider>,
  );
  await act(async () => undefined);
}

const drawerParam = (key: string) => new URLSearchParams(window.location.search).get(key);

beforeEach(() => {
  drawerChrome.setState(drawerChrome.getInitialState(), true);
  useTraceEditStore.getState().discard();
  setWindowAddress({ url: PAGE });
});

afterEach(() => {
  cleanup();
  useTraceEditStore.getState().discard();
});

describe("given the installed drawer registry is mounted", () => {
  describe("when a trace list row opens its trace", () => {
    /** @scenario "The trace drawer opens over a page that is not the Trace Explorer" */
    it("opens the declared trace drawer over the page", async () => {
      await renderPageWithDrawerHost({
        trace: { traceId: TRACE, timestamp: 1_700_000_000_000, spanCount: 3 } as TraceListItem,
      });

      fireEvent.click(screen.getByRole("button", { name: "open trace" }));

      expect(await screen.findByTestId("trace-v2-shell")).toBeInTheDocument();
      expect(drawerParam("drawer.open")).toBe("traceV2Details");
      expect(drawerParam("drawer.traceId")).toBe(TRACE);
      expect(window.location.pathname).toBe(PAGE);
    });
  });

  describe("when browser history moves off a trace with an unsaved correction", () => {
    /** @scenario "Browser back with unsaved changes keeps the correction" */
    it("puts the declared trace drawer back so the question has somewhere to live", async () => {
      setWindowAddress({
        url: `${PAGE}?drawer.open=traceV2Details&drawer.traceId=${TRACE}&drawer.edit=1`,
      });
      useTraceEditStore.getState().startEditing({ traceId: TRACE });
      useTraceEditStore.getState().setSpanName({
        spanId: "span-1",
        name: "search the web",
        baselineName: "handler",
      });
      await renderPageWithDrawerHost();
      expect(await screen.findByTestId("trace-v2-shell")).toBeInTheDocument();

      act(() => setWindowAddress({ url: PAGE }));

      expect(await screen.findByTestId("trace-v2-shell")).toBeInTheDocument();
      expect(drawerParam("drawer.open")).toBe("traceV2Details");
      expect(drawerParam("drawer.edit")).toBe("1");
      expect(useTraceEditStore.getState().spanDrafts["span-1"]?.name).toBe("search the web");
    });
  });
});
