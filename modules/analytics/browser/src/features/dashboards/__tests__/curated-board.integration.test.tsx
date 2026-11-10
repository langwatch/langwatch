/**
 * @vitest-environment jsdom
 * A From LangWatch board: a template shown live and read-only, stored nowhere, whose
 * widgets with no query yet say so instead of showing numbers, and whose every widget
 * offers Ask Langy when Langy is available.
 * @see modules/dashboard/specs/dashboards-v2.feature
 */

import type { UiProcedureCall } from "@langwatch/browser/testing-transport";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ANALYTICS_MEMBER_PERMISSIONS, StubAnalyticsHost } from "../../../testing.tsx";
import { PICKER_QUESTIONS, pickerWidgets } from "../catalogue/index.ts";
import { curatedBoardById } from "../model/curated-boards.ts";
import CuratedBoardScreen from "../ui/sections/curated-board.screen.tsx";
import {
  HOME_BOARD,
  NO_PROCEDURES,
  RecordingUiAnalytics,
  renderDashboards,
  withAnalytics,
} from "./render-dashboards.test-helpers.tsx";

// jsdom loads no stylesheet, so the theme colours a chart frame is handed have no value to read.
vi.mock(import("@langwatch/design-system/color-mode"), async (importOriginal) => ({
  ...(await importOriginal()),
  getRawColorValue: () => "#123456",
}));

const LANGY_ON = { release_dashboards: true, release_langy_enabled: true };
const MEMBER = [...ANALYTICS_MEMBER_PERMISSIONS, "langy:create"];
const WRITES =
  /^boards\.(?:create|update|delete)$|^dashboards\.(?!getAll|listStarred|sourcePresence)|^dashboardWidgets\.(?!list)/;
const PICKER_OPEN = { addBlock: "open" };

const tracked = new RecordingUiAnalytics();

/** A saved board in the project in view, as the list returns it. */
const storedBoard = ({ name, index }: { name: string; index: number }) => ({
  ...HOME_BOARD,
  id: `stored-${index}`,
  name,
  order: index,
  description: null,
  createdById: "user-1",
  isStarred: false,
  createdAt: new Date("2026-01-01"),
  updatedAt: new Date("2026-01-01"),
  _count: { graphs: 0 },
});

/** The curated reads plus the create-and-fill path; every call is kept, so a write would show. */
function curatedServer(storedNames: readonly string[] = []) {
  const calls: UiProcedureCall[] = [];
  const answer = (call: UiProcedureCall): Promise<unknown> => {
    calls.push(call);
    if (call.path === "boards.getAll") {
      return Promise.resolve(storedNames.map((name, index) => storedBoard({ name, index })));
    }
    if (call.path === "boards.listStarred") return Promise.resolve([]);
    switch (call.path) {
      case "boards.create":
        return Promise.resolve({ id: "board-1", ...(call.input as object) });
      case "boards.update":
      case "dashboardWidgets.batchUpdateLayouts":
        return Promise.resolve({ success: true });
      case "dashboardWidgets.create":
        return Promise.resolve({ id: "widget-1" });
      default:
        return NO_PROCEDURES(call);
    }
  };
  return { calls, answer };
}

function openCurated({
  templateId,
  flags = LANGY_ON,
  permissions = MEMBER,
  storedNames = [],
  query = {},
}: {
  templateId: string;
  flags?: Record<string, boolean>;
  permissions?: readonly string[];
  storedNames?: readonly string[];
  /** The address's query, as when "Add a widget" is already open. */
  query?: Record<string, string>;
}) {
  const server = curatedServer(storedNames);
  const host = new StubAnalyticsHost({
    flags,
    permissions,
    route: { params: { templateId }, query },
  });
  renderDashboards({
    element: withAnalytics(<CuratedBoardScreen />, tracked),
    host,
    answer: server.answer,
  });
  return { host, server };
}

afterEach(() => {
  cleanup();
  tracked.events.length = 0;
});

describe("given a member opens a From LangWatch board", () => {
  /** @scenario "From LangWatch: a template board is live and read-only" */
  it("shows the template badged, with no Duplicate to edit in the header and no way to change it", async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    const { server } = openCurated({ templateId: "release" });

    expect(await screen.findByRole("heading", { name: "Release check" })).toBeInTheDocument();
    expect(screen.getByText("From LangWatch")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Duplicate to edit" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Add a widget" })).toBeNull();
    // A widget's menu holds the export and nothing that changes the board.
    await user.click(screen.getAllByRole("button", { name: /^Actions for / })[0]!);
    const items = await screen.findAllByRole("menuitem");
    expect(items.map((item) => item.textContent?.trim())).toEqual(["Export CSV Still loading"]);
    expect(server.calls.filter(({ path }) => WRITES.test(path))).toEqual([]);
  });

  /** @scenario "AC3i The Dashboards pages do not point back to the old Analytics" */
  it("does not point back to the old Analytics", async () => {
    openCurated({ templateId: "release" });

    await screen.findByRole("heading", { name: "Release check" });
    expect(screen.queryByText(/Looking for the old Analytics/)).toBeNull();
  });

  describe("when the board is Can I trust my numbers?", () => {
    /** @scenario "From LangWatch: every widget on a template board has code" */
    it("shows its four widgets and no placeholder", async () => {
      openCurated({ templateId: "data" });

      expect(
        await screen.findByRole("heading", { name: "Can I trust my numbers?" }),
      ).toBeInTheDocument();
      expect(screen.getByText("Is my data complete?")).toBeInTheDocument();
      expect(screen.getByText("Which of my traces are noise?")).toBeInTheDocument();
      expect(screen.queryByText("Not built yet")).toBeNull();
    });
  });

  describe("when Langy is available", () => {
    /** @scenario "AC120b Ask Langy: every widget on every board has Ask Langy, From LangWatch boards included" */
    it("gives every widget an Ask Langy button that drafts that widget's prompt", async () => {
      const user = userEvent.setup({ pointerEventsCheck: 0 });
      const { host } = openCurated({ templateId: "release" });
      const names = curatedBoardById("release")?.widgets.map(({ name }) => name) ?? [];

      await screen.findByRole("heading", { name: "Release check" });
      const asks = screen.getAllByRole("button", { name: /^Ask Langy about / });
      expect(asks.map((button) => button.getAttribute("aria-label") ?? "").toSorted()).toEqual(
        names.map((name) => `Ask Langy about ${name}`).toSorted(),
      );

      await user.click(asks[0]!);

      expect(host.langyAsks).toHaveLength(1);
      expect(host.langyAsks[0]?.question).toBeUndefined();
      expect(host.langyAsks[0]?.draft).toContain(names[0]);
      expect(host.langyAsks[0]?.context[0]?.ref).toContain("From LangWatch dashboard");
    });
  });

  describe("when Langy is off", () => {
    /** @scenario "AC120b Ask Langy: every widget on every board has Ask Langy, From LangWatch boards included" */
    it("shows no Ask Langy on any widget", async () => {
      openCurated({ templateId: "release", flags: { release_dashboards: true } });

      await screen.findByRole("heading", { name: "Release check" });
      expect(screen.queryByRole("button", { name: /^Ask Langy about / })).toBeNull();
    });
  });

  describe("when a member who may create dashboards clicks its ask bar", () => {
    /** @scenario "From LangWatch: the ask bar opens Add a widget for a member who may create dashboards" */
    it("opens Add a widget, with nothing stored and Langy asked nothing", async () => {
      const user = userEvent.setup();
      const { host, server } = openCurated({ templateId: "breaks" });

      await user.click(await screen.findByRole("button", { name: "What do you want to know?" }));

      expect(host.lastQuery).toEqual(PICKER_OPEN);
      expect(host.langyAsks).toEqual([]);
      expect(server.calls.filter(({ path }) => WRITES.test(path))).toEqual([]);
    });

    /** @scenario "From LangWatch: the picker has no I'll build it myself" */
    it("offers no I'll build it myself", async () => {
      openCurated({ templateId: "breaks", query: PICKER_OPEN });

      await screen.findByRole("heading", { name: "Add a widget" });
      expect(screen.queryByRole("button", { name: "I'll build it myself" })).toBeNull();
      // Langy stays one click away from the picker.
      expect(screen.getByRole("button", { name: "Ask Langy" })).toBeInTheDocument();
      // With nothing matching, it points to clearing the search, not to building one.
      fireEvent.change(screen.getByRole("searchbox", { name: "What do you want to know?" }), {
        target: { value: "zzz-no-such-widget" },
      });
      expect(
        screen.getByText("No widget matches. Clear the search and filters to see them all."),
      ).toBeInTheDocument();
    });

    /** @scenario "From LangWatch: picking a widget makes a new dashboard with only that widget" */
    it("makes a dashboard of only the picked widget and opens it", async () => {
      const user = userEvent.setup({ pointerEventsCheck: 0 });
      const traffic = PICKER_QUESTIONS.find(({ id }) => id === "traffic")!;
      const widgetName = pickerWidgets(traffic.id)[0]!.name;
      const { host, server } = openCurated({ templateId: "breaks", query: PICKER_OPEN });

      await user.click(
        await screen.findByRole("button", {
          name: (accessible) => accessible.startsWith(traffic.question),
        }),
      );

      await waitFor(() => expect(host.navigations).toEqual(["/test-project/dashboards/board-1"]));
      const inputsTo = (path: string) =>
        server.calls.filter((call) => call.path === path).map(({ input }) => input);
      expect(inputsTo("boards.create")).toEqual([{ projectId: "proj-1", name: widgetName }]);
      expect(inputsTo("dashboardWidgets.create")).toHaveLength(1);
      expect(inputsTo("dashboardWidgets.create")[0]).toMatchObject({
        dashboardId: "board-1",
        name: widgetName,
      });
      // The curated board is not the new board's context, so no draft is seeded; let a stray one land.
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(host.langyAsks).toEqual([]);
      const created = tracked.events.filter(
        ({ name, action }) => name === "dashboard" && action === "created",
      );
      expect(created.map(({ attributes }) => attributes)).toEqual([
        { createdFrom: "widget_curated", templateId: "breaks" },
      ]);
    });

    /** @scenario "From LangWatch: picking a widget makes a new dashboard with only that widget" */
    it("numbers the new dashboard from 2 when a dashboard already has the widget's name", async () => {
      const user = userEvent.setup({ pointerEventsCheck: 0 });
      const traffic = PICKER_QUESTIONS.find(({ id }) => id === "traffic")!;
      const widgetName = pickerWidgets(traffic.id)[0]!.name;
      const { host, server } = openCurated({
        templateId: "breaks",
        storedNames: [widgetName],
        query: PICKER_OPEN,
      });

      await user.click(
        await screen.findByRole("button", {
          name: (accessible) => accessible.startsWith(traffic.question),
        }),
      );

      await waitFor(() => expect(host.navigations).toHaveLength(1));
      expect(
        server.calls.filter(({ path }) => path === "boards.create").map(({ input }) => input),
      ).toEqual([{ projectId: "proj-1", name: `${widgetName} 2` }]);
    });
  });

  describe("when a member who may not create dashboards clicks its ask bar", () => {
    /** @scenario "From LangWatch: the ask bar asks Langy for a member who may not create dashboards" */
    it("opens Langy about the template board with nothing asked yet", async () => {
      const user = userEvent.setup();
      const { host } = openCurated({
        templateId: "breaks",
        permissions: MEMBER.filter((permission) => permission !== "analytics:create"),
      });

      await user.click(await screen.findByRole("button", { name: "What do you want to know?" }));

      expect(host.langyAsks).toHaveLength(1);
      expect(host.langyAsks[0]?.question).toBeUndefined();
      expect(host.langyAsks[0]?.context[0]?.ref).toContain("From LangWatch dashboard");
    });
  });

  describe("when Langy is off and the member may create dashboards", () => {
    /** @scenario "Boards: every board has the ask bar" */
    it("keeps the ask bar, and a click opens Add a widget", async () => {
      const user = userEvent.setup();
      const { host } = openCurated({
        templateId: "breaks",
        flags: { release_dashboards: true },
      });

      await user.click(await screen.findByRole("button", { name: "What do you want to know?" }));

      expect(host.lastQuery).toEqual(PICKER_OPEN);
    });

    /** @scenario "Boards: every board has the ask bar" */
    it("shows Add a widget when the address asks for it", async () => {
      openCurated({
        templateId: "breaks",
        flags: { release_dashboards: true },
        query: PICKER_OPEN,
      });

      expect(await screen.findByRole("heading", { name: "Add a widget" })).toBeInTheDocument();
    });
  });

  describe("when a member who may not create dashboards loads the address with Add a widget open", () => {
    /** @scenario "From LangWatch: the ask bar asks Langy for a member who may not create dashboards" */
    it("shows no picker", async () => {
      openCurated({
        templateId: "breaks",
        permissions: MEMBER.filter((permission) => permission !== "analytics:create"),
        query: PICKER_OPEN,
      });

      await screen.findByRole("heading", { name: "Where my agent breaks" });
      expect(screen.queryByRole("heading", { name: "Add a widget" })).toBeNull();
    });
  });

  describe("when the address names no From LangWatch board", () => {
    /** @scenario "From LangWatch: a template board is live and read-only" */
    it("shows the not-found page", async () => {
      openCurated({ templateId: "nope" });

      expect(
        await screen.findByRole("heading", { name: "This page is not here" }),
      ).toBeInTheDocument();
    });
  });
});
