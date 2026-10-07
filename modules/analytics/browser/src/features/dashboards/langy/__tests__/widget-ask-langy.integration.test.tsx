/**
 * @vitest-environment jsdom
 * Ask Langy on a widget card, against an in-memory dashboards and widgets server: the
 * button shows only with Langy, drafts that widget's prompt, and a duplicate keeps it; the
 * widget menu's alert and report actions draft Langy to set them up.
 * @see modules/dashboard/specs/dashboards-v2.feature
 */

import type { UiProcedureCall } from "@langwatch/browser/testing-transport";
import { cleanup, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";

import { StubAnalyticsHost } from "../../../../testing.tsx";
import {
  NO_PROCEDURES,
  renderDashboards,
} from "../../__tests__/render-dashboards.test-helpers.tsx";
import DashboardBoardScreen from "../../ui/sections/dashboard-board.screen.tsx";

const BOARD = {
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
      case "dashboards.listStarred":
        return Promise.resolve([]);
      case "dashboards.getAll":
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
const MEMBER = ["analytics:view", "cost:view", "traces:view"];
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

afterEach(cleanup);

describe("Ask Langy on a widget card", () => {
  describe("given Langy is on and the member may start a conversation", () => {
    /** @scenario "AC120 Ask Langy: each widget card offers Ask Langy only when Langy is available" */
    it("shows the button between the info icon and the widget menu", async () => {
      openBoard({ server: inMemoryServer() });

      const ask = await screen.findByRole("button", { name: ASK_TRAFFIC });
      const info = screen.getByRole("button", { name: "About Traffic" });
      const menu = screen.getByRole("button", { name: "Actions for Traffic" });
      expect(info.compareDocumentPosition(ask) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      expect(ask.compareDocumentPosition(menu) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
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
        expect(request?.draft?.startsWith(PROMPT)).toBe(true);
        expect(request?.draft).toContain("Name: Traffic");
        expect(request?.draft).toContain("Description: Traces per bucket");
        expect(request?.draft).toContain(`- series:\n${SQL}`);
        expect(request?.draft).toContain("Dashboard period:");
        expect(request?.context[0]).toMatchObject({ kind: "dashboard", label: "Weekly review" });
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
      expect(request?.draft).toContain(`- series:\n${SQL}`);
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
