/**
 * @vitest-environment jsdom
 * Ask Langy on a widget card, against an in-memory dashboards and widgets server: the
 * button shows only with Langy, drafts that widget's prompt, and a duplicate keeps it; the
 * widget menu's alert and report actions draft Langy to set them up.
 * @see modules/dashboard/specs/dashboards-v2.feature
 */

import { useInPlaceDrawerOpen } from "@langwatch/browser-host/drawer";
import type { UiProcedureCall } from "@langwatch/browser/testing-transport";
import { DIALOG_COMPANION_ATTR, useCompanionDialogOpen } from "@langwatch/design-system/dialog";
import {
  act,
  cleanup,
  fireEvent,
  renderHook,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ANALYTICS_MEMBER_PERMISSIONS, StubAnalyticsHost } from "../../../../testing.tsx";
import {
  HOME_BOARD,
  NO_PROCEDURES,
  renderDashboards,
} from "../../__tests__/render-dashboards.test-helpers.tsx";
import DashboardBoardScreen from "../../ui/sections/dashboard-board.screen.tsx";

// jsdom loads no stylesheet, so the theme colours a chart frame is handed have no value to read.
vi.mock(import("@langwatch/design-system/color-mode"), async (importOriginal) => ({
  ...(await importOriginal()),
  getRawColorValue: () => "#123456",
}));

const BOARD = {
  ...HOME_BOARD,
  id: "board-1",
  name: "Weekly review",
  description: null,
  createdById: "user-1",
  isStarred: false,
  updatedAt: new Date("2026-01-01"),
};
const PROMPT = "How much traffic did my agent get? Quote the real numbers.";
const SQL = "SELECT count() FROM trace_metrics_by_minute";
const WIDGET = {
  id: "w-1",
  dashboardId: BOARD.id,
  name: "Traffic",
  graph: {
    version: 1,
    code: "export default function Widget() { return null; }",
    queries: [{ name: "series", sql: SQL }],
    description: "Traces per bucket",
    prompt: PROMPT,
  },
  gridColumn: 0,
  gridRow: 0,
  colSpan: 4,
  rowSpan: 3,
};

/** One board with one prompted widget, answered from memory; every call is kept. */
function inMemoryServer() {
  const state = { calls: [] as UiProcedureCall[] };
  const answer = (call: UiProcedureCall): Promise<unknown> => {
    state.calls.push(call);
    switch (call.path) {
      case "boards.listStarred":
        return Promise.resolve([]);
      case "boards.getAll":
        return Promise.resolve([{ ...BOARD }]);
      case "dashboardWidgets.list":
        return Promise.resolve([{ ...WIDGET }]);
      case "dashboardWidgets.create":
        return Promise.resolve({ ...WIDGET, id: "w-2", definition: WIDGET.graph });
      case "dashboardWidgets.updateLayout":
        return Promise.resolve({ success: true });
      default:
        return NO_PROCEDURES(call);
    }
  };
  return { state, answer };
}

const LANGY_ON = { release_dashboards: true, release_langy_enabled: true };
const MEMBER = [...ANALYTICS_MEMBER_PERMISSIONS];
const LANGY_MEMBER = [...MEMBER, "langy:create"];
const ASK_TRAFFIC = "Ask Langy about Traffic";

function openBoard({
  server,
  flags = LANGY_ON,
  permissions = LANGY_MEMBER,
}: {
  server: ReturnType<typeof inMemoryServer>;
  flags?: Record<string, boolean>;
  permissions?: string[];
}) {
  const host = new StubAnalyticsHost({
    flags,
    permissions,
    route: { params: { dashboardId: BOARD.id }, query: {} },
  });
  renderDashboards({ element: <DashboardBoardScreen />, host, answer: server.answer });
  return host;
}

/** A stand-in for the Langy panel, outside the dialog as Langy is. */
function langyPanel() {
  const panel = document.createElement("aside");
  panel.setAttribute(DIALOG_COMPANION_ATTR, "");
  const field = document.createElement("textarea");
  field.setAttribute("aria-label", "Message Langy");
  panel.append(field);
  document.body.append(panel);
  return field;
}

/** Past the frame the dialog waits before it listens for Escape and clicks outside it. */
const settle = () => act(() => new Promise((resolve) => setTimeout(resolve, 50)));

afterEach(() => {
  cleanup();
  for (const panel of document.querySelectorAll(`[${DIALOG_COMPANION_ATTR}]`)) panel.remove();
});

describe("Ask Langy on a widget card", () => {
  describe("given Langy is on and the member may start a conversation", () => {
    /** @scenario "AC120 Ask Langy: each widget card offers Ask Langy only when Langy is available" */
    /** @scenario "AC120b Ask Langy: every widget on every board has Ask Langy, From LangWatch boards included" */
    it("shows the button between the info icon and the widget menu", async () => {
      openBoard({ server: inMemoryServer() });

      const ask = await screen.findByRole("button", { name: ASK_TRAFFIC });
      const info = screen.getByRole("button", { name: "About Traffic" });
      const menu = screen.getByRole("button", { name: "Actions for Traffic" });
      expect(info.compareDocumentPosition(ask) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      expect(ask.compareDocumentPosition(menu) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      expect(ask).toHaveTextContent("Ask Langy");
      // Shown on hover or focus with the menu, never on a card at rest.
      const controls = ask.closest("[data-testid='widget-card-controls']");
      expect(controls).not.toBeNull();
      expect(controls).toContainElement(menu);
    });

    describe("when the member clicks it", () => {
      /** @scenario "AC121 Ask Langy: clicking drafts the widget's prompt with its name, queries and the period" */
      it("hands Langy a draft of the widget's prompt, the widget and the period, with the board", async () => {
        const user = userEvent.setup({ pointerEventsCheck: 0 });
        const host = openBoard({ server: inMemoryServer() });

        await user.click(await screen.findByRole("button", { name: ASK_TRAFFIC }));

        expect(host.langyAsks).toHaveLength(1);
        const [request] = host.langyAsks;
        expect(request?.question).toBeUndefined();
        expect(request?.draft).toMatch(/^What does "Traffic" show over the last 30 days\?/);
        expect(request?.draft).not.toContain(SQL);
        const widgetRef = request?.context[1]?.ref ?? "";
        expect(widgetRef).toContain(`how to answer it: ${PROMPT}`);
        expect(widgetRef).toContain("description: Traces per bucket");
        expect(widgetRef).toContain(`series: ${SQL}`);
        expect(request?.context[0]).toMatchObject({ kind: "dashboard", label: "Weekly review" });
      });

      /** @scenario "AC121b Ask Langy: clicking opens the widget in a centred dialog shaped like its card" */
      it("opens the widget in a dialog Langy stays above, and Escape closes it", async () => {
        const user = userEvent.setup({ pointerEventsCheck: 0 });
        openBoard({ server: inMemoryServer() });

        await user.click(await screen.findByRole("button", { name: ASK_TRAFFIC }));

        const view = await screen.findByRole("dialog", { name: "Traffic" });
        expect(view).toHaveTextContent("Traces per bucket");
        expect(within(view).getByTestId("widget-langy-view-chart")).toBeInTheDocument();
        expect(within(view).getAllByTitle("Custom chart").length).toBeGreaterThan(0);
        expect(view).not.toHaveTextContent("in the panel beside it");
        // Langy lifts above the dialog's backdrop, and is no drawer's companion that moves aside.
        const besideDialog = renderHook(() => useCompanionDialogOpen());
        const drawerOpen = renderHook(() => useInPlaceDrawerOpen());
        expect(besideDialog.result.current).toBe(true);
        expect(drawerOpen.result.current).toBe(false);
        await settle();

        await user.keyboard("{Escape}");

        await waitFor(() => expect(screen.queryByRole("dialog", { name: "Traffic" })).toBeNull());
        expect(besideDialog.result.current).toBe(false);
        expect(screen.getByRole("button", { name: ASK_TRAFFIC })).toBeInTheDocument();
      });

      /** @scenario "AC121f Ask Langy: the widget stays in Langy's context after the dialog closes" */
      it("tells Langy nothing new when the dialog closes, so the widget stays in its context", async () => {
        const user = userEvent.setup({ pointerEventsCheck: 0 });
        const host = openBoard({ server: inMemoryServer() });
        await user.click(await screen.findByRole("button", { name: ASK_TRAFFIC }));
        await screen.findByRole("dialog", { name: "Traffic" });
        await settle();
        const screensAtAsk = [...host.langyScreens];

        await user.keyboard("{Escape}");
        await waitFor(() => expect(screen.queryByRole("dialog", { name: "Traffic" })).toBeNull());

        // Langy drops a seed and its context only when the screen moves off what it is about.
        expect(host.langyScreens).toEqual(screensAtAsk);
        expect(host.langyScreens.at(-1)).toEqual(host.langyAsks[0]?.about);
        expect(host.langyAsks).toHaveLength(1);
      });

      /** @scenario "AC121d Ask Langy: Langy stays usable above the widget dialog" */
      it("stays open while the member types, clicks and presses Escape in Langy, and closes on the blurred board", async () => {
        const user = userEvent.setup({ pointerEventsCheck: 0 });
        const field = langyPanel();
        openBoard({ server: inMemoryServer() });
        await user.click(await screen.findByRole("button", { name: ASK_TRAFFIC }));
        const view = await screen.findByRole("dialog", { name: "Traffic" });
        await settle();

        await user.click(field);
        await user.type(field, "why so many?");
        await user.keyboard("{Escape}");
        await settle();

        expect(field).toHaveFocus();
        expect(field).toHaveValue("why so many?");
        expect(screen.getByRole("dialog", { name: "Traffic" })).toBe(view);

        const board = view.closest<HTMLElement>("[data-part='positioner']");
        if (!board) throw new Error("the dialog stands on no positioner");
        await waitFor(() => {
          fireEvent.pointerDown(board);
          expect(screen.queryByRole("dialog", { name: "Traffic" })).toBeNull();
        });
      });
    });
  });

  describe("given Langy is off for the project", () => {
    /** @scenario "AC120 Ask Langy: each widget card offers Ask Langy only when Langy is available" */
    it("shows no Ask Langy button", async () => {
      openBoard({ server: inMemoryServer(), flags: { release_dashboards: true } });

      expect(
        await screen.findByRole("button", { name: "Actions for Traffic" }),
      ).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: ASK_TRAFFIC })).toBeNull();
    });
  });

  describe("given the member may not start a Langy conversation", () => {
    /** @scenario "AC120 Ask Langy: each widget card offers Ask Langy only when Langy is available" */
    it("shows no Ask Langy button", async () => {
      openBoard({ server: inMemoryServer(), permissions: MEMBER });

      expect(
        await screen.findByRole("button", { name: "Actions for Traffic" }),
      ).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: ASK_TRAFFIC })).toBeNull();
    });
  });

  describe("when the member opens a widget's menu with Langy available", () => {
    /**
     * @scenario "AC142 Widget menu: Set an alert drafts Langy to alert on that widget"
     * @scenario "AC143 Widget menu: Send as a report drafts Langy to schedule that widget"
     */
    it.each([
      ["Set an alert", 'Set up an alert on my "Traffic" dashboard widget.'],
      ["Send as a report", 'Send my "Traffic" dashboard widget as a scheduled report.'],
    ])("%s drafts Langy to set it up for that widget", async (action, opening) => {
      const user = userEvent.setup({ pointerEventsCheck: 0 });
      const host = openBoard({ server: inMemoryServer() });

      await user.click(await screen.findByRole("button", { name: "Actions for Traffic" }));
      await user.click(await screen.findByRole("menuitem", { name: action }));

      expect(host.langyAsks).toHaveLength(1);
      const [request] = host.langyAsks;
      expect(request?.question).toBeUndefined();
      expect(request?.draft?.startsWith(opening)).toBe(true);
      expect(request?.draft).not.toContain(SQL);
      expect(request?.context[1]?.ref).toContain(`series: ${SQL}`);
      expect(request?.context[0]).toMatchObject({ kind: "dashboard", label: "Weekly review" });
    });
  });

  describe("when the member opens a widget's menu without Langy", () => {
    /** @scenario "AC143b Widget menu: without Langy the menu offers no alert or report" */
    it("offers no Edit with Langy, alert or report", async () => {
      const user = userEvent.setup({ pointerEventsCheck: 0 });
      openBoard({ server: inMemoryServer(), permissions: MEMBER });

      await user.click(await screen.findByRole("button", { name: "Actions for Traffic" }));

      const items = await screen.findAllByRole("menuitem");
      expect(items.map((item) => item.textContent?.trim())).toEqual([
        "Edit code",
        "Copy widget id",
        "Copy API snippet",
        "Export CSV Still loading",
        "Duplicate",
        "Delete",
      ]);
    });
  });

  describe("when the member duplicates a prompted widget", () => {
    /** @scenario "AC123 Ask Langy: the prompt is stored on built widgets and kept on edit and duplicate" */
    it("copies the prompt onto the new widget", async () => {
      const user = userEvent.setup({ pointerEventsCheck: 0 });
      const server = inMemoryServer();
      openBoard({ server });

      await user.click(await screen.findByRole("button", { name: "Actions for Traffic" }));
      await user.click(await screen.findByRole("menuitem", { name: /Duplicate/ }));

      await waitFor(() =>
        expect(
          server.state.calls.find(({ path }) => path === "dashboardWidgets.create"),
        ).toBeDefined(),
      );
      const created = server.state.calls.find(({ path }) => path === "dashboardWidgets.create");
      expect(created?.input).toMatchObject({ name: "Traffic", prompt: PROMPT });
    });
  });
});
