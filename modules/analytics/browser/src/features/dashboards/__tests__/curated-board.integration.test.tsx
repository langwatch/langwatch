/**
 * @vitest-environment jsdom
 * A From LangWatch board: a template shown live and stored nowhere, whose every widget offers
 * Ask Langy when Langy is available, and whose first change asks, then makes the member's copy.
 * @see modules/dashboard/specs/dashboards-v2.feature
 */

import type { UiProcedureCall } from "@langwatch/browser/testing-transport";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
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
function curatedServer({
  organizationArea = true,
  storedNames = [],
  boardsGate,
  createFails = false,
  pinnedTemplateId,
}: {
  organizationArea?: boolean;
  storedNames?: readonly string[];
  /** Holds the saved boards' answer until it resolves. */
  boardsGate?: Promise<void>;
  createFails?: boolean;
  /** A From LangWatch board the member pinned. */
  pinnedTemplateId?: string;
} = {}) {
  const calls: UiProcedureCall[] = [];
  const answer = (call: UiProcedureCall): Promise<unknown> => {
    calls.push(call);
    if (call.path === "boards.getAll") {
      return (boardsGate ?? Promise.resolve()).then(() =>
        storedNames.map((name, index) => storedBoard({ name, index })),
      );
    }
    if (call.path === "boards.listStarred") {
      const pinned = pinnedTemplateId === void 0 ? [] : [pinnedTemplateId];
      return Promise.resolve(pinned.map((templateId) => ({ kind: "template", templateId })));
    }
    switch (call.path) {
      case "featureFlag.isEnabledForEachOrganization":
        return Promise.resolve({ enabledByOrganizationId: { "org-1": organizationArea } });
      case "boards.create":
        if (createFails) return Promise.reject(new Error("boards.create failed"));
        return Promise.resolve({ id: "board-1", ...(call.input as object) });
      case "boards.update":
      case "boards.star":
      case "boards.unstar":
      case "boards.reorderStars":
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
  organizationArea,
  permissions = MEMBER,
  storedNames = [],
  boardsGate,
  createFails,
  pinnedTemplateId,
  query = {},
}: {
  templateId: string;
  flags?: Record<string, boolean>;
  /** The organization's Dashboards area flag; on unless a scenario turns it off. */
  organizationArea?: boolean;
  permissions?: readonly string[];
  storedNames?: readonly string[];
  boardsGate?: Promise<void>;
  createFails?: boolean;
  pinnedTemplateId?: string;
  /** The address's query, as when "Add a widget" is already open. */
  query?: Record<string, string>;
}) {
  const server = curatedServer({
    organizationArea,
    storedNames,
    boardsGate,
    createFails,
    pinnedTemplateId,
  });
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

const NO_CREATE = MEMBER.filter((permission) => permission !== "analytics:create");
const RELEASE = curatedBoardById("release")!;

const inputsTo = (server: ReturnType<typeof curatedServer>, path: string) =>
  server.calls.filter((call) => call.path === path).map(({ input }) => input);

/** Opens the first widget's menu and picks one of its items. */
async function pickWidgetAction({
  user,
  action,
}: {
  user: ReturnType<typeof userEvent.setup>;
  action: string;
}) {
  // The organization's flag answers after the first paint; its edit controls come with it.
  await screen.findByRole("button", { name: "Add a widget" });
  await user.click(screen.getAllByRole("button", { name: /^Actions for / })[0]!);
  await user.click(await screen.findByRole("menuitem", { name: action }));
}

describe("given a member opens a From LangWatch board", () => {
  describe("when the member may create dashboards", () => {
    /** @scenario "From LangWatch: a template board is live and offers every edit" */
    it("shows the template badged, with every edit an own board offers and nothing stored", async () => {
      const user = userEvent.setup({ pointerEventsCheck: 0 });
      const { server } = openCurated({ templateId: "release" });

      expect(await screen.findByRole("heading", { name: "Ready to ship?" })).toBeInTheDocument();
      expect(await screen.findByRole("button", { name: "Add a widget" })).toBeInTheDocument();
      expect(screen.getByText("From LangWatch")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Use this template" })).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Duplicate to edit" })).toBeNull();
      expect(screen.getByTitle("Edit name")).toBeInTheDocument();
      expect(screen.getByTitle("Edit description")).toBeInTheDocument();
      expect(screen.getAllByTitle("Drag to move")).toHaveLength(RELEASE.widgets.length);
      await user.click(screen.getAllByRole("button", { name: /^Actions for / })[0]!);
      const items = await screen.findAllByRole("menuitem");
      expect(items.map((item) => item.textContent?.trim())).toEqual([
        "Edit code",
        "Export CSV Still loading",
        "Delete",
      ]);
      expect(server.calls.filter(({ path }) => WRITES.test(path))).toEqual([]);
    });
  });

  describe("when the member may not create dashboards", () => {
    /** @scenario "From LangWatch: a member who may not create dashboards gets no edit control" */
    it("offers no edit control, and a widget's menu holds only Export CSV", async () => {
      const user = userEvent.setup({ pointerEventsCheck: 0 });
      const { server } = openCurated({ templateId: "release", permissions: NO_CREATE });

      expect(await screen.findByRole("heading", { name: "Ready to ship?" })).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Add a widget" })).toBeNull();
      expect(screen.queryByRole("button", { name: "Use this template" })).toBeNull();
      expect(screen.queryByTitle("Edit name")).toBeNull();
      expect(screen.queryByTitle("Edit description")).toBeNull();
      expect(screen.queryByTitle("Drag to move")).toBeNull();
      await user.click(screen.getAllByRole("button", { name: /^Actions for / })[0]!);
      const items = await screen.findAllByRole("menuitem");
      expect(items.map((item) => item.textContent?.trim())).toEqual(["Export CSV Still loading"]);
      expect(server.calls.filter(({ path }) => WRITES.test(path))).toEqual([]);
    });
  });

  describe("when the organization's Dashboards area is off", () => {
    /** @scenario "With the flag off, a From LangWatch board is read-only, as on main" */
    it("offers no edit control, though the member may create dashboards", async () => {
      const { server } = openCurated({ templateId: "release", organizationArea: false });

      expect(await screen.findByRole("heading", { name: "Ready to ship?" })).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Add a widget" })).toBeNull();
      expect(screen.queryByRole("button", { name: "Use this template" })).toBeNull();
      expect(screen.queryByTitle("Edit name")).toBeNull();
      expect(screen.queryByTitle("Edit description")).toBeNull();
      expect(screen.queryByTitle("Drag to move")).toBeNull();
      expect(server.calls.filter(({ path }) => WRITES.test(path))).toEqual([]);
    });
  });

  describe("when the member starts a change", () => {
    /** @scenario "From LangWatch: the first change asks before it makes the member's own copy" */
    it("asks before making their own copy, with Cancel and Yes, modify it", async () => {
      const user = userEvent.setup({ pointerEventsCheck: 0 });
      const { server } = openCurated({ templateId: "release" });

      await user.click(await screen.findByRole("button", { name: "Add a widget" }));

      const dialog = await screen.findByRole("dialog");
      expect(within(dialog).getByText("Modify a LangWatch dashboard?")).toBeInTheDocument();
      expect(
        within(dialog).getByText(
          "This dashboard is maintained by LangWatch. If you change it, it becomes your own " +
            "copy and stops getting LangWatch updates. You can add the original again from " +
            "Templates at any time.",
        ),
      ).toBeInTheDocument();
      expect(within(dialog).getByRole("button", { name: "Cancel" })).toBeInTheDocument();
      expect(within(dialog).getByRole("button", { name: "Yes, modify it" })).toBeInTheDocument();
      expect(server.calls.filter(({ path }) => WRITES.test(path))).toEqual([]);
    });

    /** @scenario "From LangWatch: the first change asks before it makes the member's own copy" */
    it("asks nothing for an unchanged name", async () => {
      const user = userEvent.setup({ pointerEventsCheck: 0 });
      openCurated({ templateId: "release" });

      await user.click(await screen.findByTitle("Edit name"));
      await user.keyboard("{Enter}");

      expect(screen.queryByRole("dialog")).toBeNull();
    });

    describe("when the member presses Cancel", () => {
      /** @scenario "From LangWatch: Cancel changes nothing" */
      it("closes the dialog, stores nothing and stays on the board", async () => {
        const user = userEvent.setup({ pointerEventsCheck: 0 });
        const { host, server } = openCurated({ templateId: "release" });

        await user.click(await screen.findByRole("button", { name: "Add a widget" }));
        await user.click(await screen.findByRole("button", { name: "Cancel" }));

        await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
        expect(screen.getByRole("heading", { name: "Ready to ship?" })).toBeInTheDocument();
        expect(host.navigations).toEqual([]);
        expect(server.calls.filter(({ path }) => WRITES.test(path))).toEqual([]);
      });
    });

    describe("when the member presses Yes, modify it after Add a widget", () => {
      /**
       * @scenario "From LangWatch: Yes, modify it makes the member's own copy and opens it on their change"
       * @scenario "Telemetry: making a board sends dashboards.created.dashboard with where it came from"
       */
      it("makes their own copy under the template's name and opens it with Add a widget open", async () => {
        const user = userEvent.setup({ pointerEventsCheck: 0 });
        const { host, server } = openCurated({ templateId: "release" });

        await user.click(await screen.findByRole("button", { name: "Add a widget" }));
        await user.click(await screen.findByRole("button", { name: "Yes, modify it" }));

        await waitFor(() =>
          expect(host.navigations).toEqual(["/test-project/dashboards/board-1?addBlock=open"]),
        );
        expect(inputsTo(server, "boards.create")).toEqual([
          { projectId: "proj-1", name: "Ready to ship?" },
        ]);
        expect(inputsTo(server, "boards.update")).toEqual([
          { projectId: "proj-1", dashboardId: "board-1", description: RELEASE.job },
        ]);
        expect(inputsTo(server, "dashboardWidgets.create")).toHaveLength(RELEASE.widgets.length);
        const created = tracked.events.filter(
          ({ name, action }) => name === "dashboard" && action === "created",
        );
        expect(created.map(({ attributes }) => attributes)).toEqual([
          { createdFrom: "duplicate_curated", templateId: "release" },
        ]);
      });
    });

    describe("when the member renames it and presses Yes, modify it", () => {
      /** @scenario "From LangWatch: Yes, modify it makes the member's own copy and opens it on their change" */
      it("makes their copy under the new name and opens it", async () => {
        const user = userEvent.setup({ pointerEventsCheck: 0 });
        const { host, server } = openCurated({ templateId: "release" });

        await user.click(await screen.findByTitle("Edit name"));
        const field = screen.getByRole("textbox", { name: "Dashboard name" });
        await user.clear(field);
        await user.type(field, "  Our release check {Enter}");
        await user.click(await screen.findByRole("button", { name: "Yes, modify it" }));

        await waitFor(() => expect(host.navigations).toEqual(["/test-project/dashboards/board-1"]));
        expect(inputsTo(server, "boards.create")).toEqual([
          { projectId: "proj-1", name: "Our release check" },
        ]);
      });
    });

    describe("when the member picks a widget's Edit code and presses Yes, modify it", () => {
      /** @scenario "From LangWatch: Yes, modify it makes the member's own copy and opens it on their change" */
      it("opens the copy with that widget's editor open", async () => {
        const user = userEvent.setup({ pointerEventsCheck: 0 });
        const { host } = openCurated({ templateId: "release" });

        await screen.findByRole("heading", { name: "Ready to ship?" });
        await pickWidgetAction({ user, action: "Edit code" });
        await user.click(await screen.findByRole("button", { name: "Yes, modify it" }));

        await waitFor(() =>
          expect(host.navigations).toEqual([
            "/test-project/dashboards/board-1?editWidget=widget-1",
          ]),
        );
      });
    });

    describe("when the member deletes a widget and presses Yes, modify it", () => {
      /** @scenario "From LangWatch: Yes, modify it makes the member's own copy and opens it on their change" */
      it("leaves that widget out of their copy", async () => {
        const user = userEvent.setup({ pointerEventsCheck: 0 });
        const { host, server } = openCurated({ templateId: "release" });

        await screen.findByRole("heading", { name: "Ready to ship?" });
        await pickWidgetAction({ user, action: "Delete" });
        await user.click(await screen.findByRole("button", { name: "Yes, modify it" }));

        await waitFor(() => expect(host.navigations).toHaveLength(1));
        expect(inputsTo(server, "dashboardWidgets.create")).toHaveLength(
          RELEASE.widgets.length - 1,
        );
      });
    });

    describe("when the member had pinned the board", () => {
      /** @scenario "From LangWatch: the copy takes over the From LangWatch board's pin" */
      it("pins the copy in its place and unpins the From LangWatch board", async () => {
        const user = userEvent.setup({ pointerEventsCheck: 0 });
        const { server } = openCurated({ templateId: "release", pinnedTemplateId: "release" });
        await waitFor(() => expect(inputsTo(server, "boards.listStarred")).toHaveLength(1));
        // Let the pins' answer land before the change is confirmed.
        await new Promise((resolve) => setTimeout(resolve, 0));

        await user.click(await screen.findByRole("button", { name: "Add a widget" }));
        await user.click(await screen.findByRole("button", { name: "Yes, modify it" }));

        const copy = { kind: "board", dashboardId: "board-1" };
        const original = { kind: "template", templateId: "release" };
        await waitFor(() =>
          expect(inputsTo(server, "boards.unstar")).toEqual([
            { projectId: "proj-1", star: original },
          ]),
        );
        expect(inputsTo(server, "boards.star")).toEqual([{ projectId: "proj-1", star: copy }]);
        expect(inputsTo(server, "boards.reorderStars")).toEqual([
          { projectId: "proj-1", stars: [copy] },
        ]);
      });
    });

    describe("when the copy cannot be made", () => {
      /** @scenario "From LangWatch: a copy that cannot be made leaves the member on the board" */
      it("stays on the board and says so", async () => {
        const user = userEvent.setup({ pointerEventsCheck: 0 });
        const { host } = openCurated({ templateId: "release", createFails: true });

        await user.click(await screen.findByRole("button", { name: "Add a widget" }));
        await user.click(await screen.findByRole("button", { name: "Yes, modify it" }));

        await waitFor(() =>
          expect(host.failures).toEqual([
            expect.objectContaining({ fallbackTitle: "Couldn't make your copy of the dashboard" }),
          ]),
        );
        await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
        expect(host.navigations).toEqual([]);
        expect(screen.getByRole("heading", { name: "Ready to ship?" })).toBeInTheDocument();
      });
    });
  });

  describe("when the member presses Use this template", () => {
    /** @scenario "From LangWatch: Use this template makes the member's own board from it" */
    it("makes their own board from the template and opens it", async () => {
      const user = userEvent.setup({ pointerEventsCheck: 0 });
      const { host, server } = openCurated({ templateId: "release" });

      await user.click(await screen.findByRole("button", { name: "Use this template" }));

      await waitFor(() => expect(host.navigations).toEqual(["/test-project/dashboards/board-1"]));
      expect(inputsTo(server, "boards.create")).toEqual([
        { projectId: "proj-1", name: RELEASE.card.board.name },
      ]);
      expect(inputsTo(server, "dashboardWidgets.create")).toHaveLength(
        RELEASE.card.board.widgets.length,
      );
      expect(screen.queryByRole("dialog")).toBeNull();
    });
  });

  /** @scenario "AC3t No other Dashboards page shows the old-Analytics banner" */
  it("shows no old-Analytics banner", async () => {
    openCurated({ templateId: "release" });

    expect(await screen.findByRole("heading", { name: "Ready to ship?" })).toBeInTheDocument();
    expect(screen.queryByTestId("old-analytics-banner")).toBeNull();
  });

  describe("when the board is Fix missing data", () => {
    /** @scenario "From LangWatch: every widget on a template board has code" */
    it("shows its four widgets and no placeholder", async () => {
      openCurated({ templateId: "data" });

      expect(await screen.findByRole("heading", { name: "Fix missing data" })).toBeInTheDocument();
      const widgets = curatedBoardById("data")?.widgets ?? [];
      expect(widgets).toHaveLength(4);
      for (const { name, definition } of widgets) {
        expect(screen.getByText(name)).toBeInTheDocument();
        expect(definition.code.trim(), name).not.toBe("");
      }
      expect(await screen.findAllByTitle("Custom chart")).toHaveLength(4);
    });
  });

  describe("when Langy is available", () => {
    /** @scenario "AC120b Ask Langy: every widget on every board has Ask Langy, From LangWatch boards included" */
    /** @scenario "AC121b Ask Langy: clicking opens the widget large beside Langy" */
    it("gives every widget an Ask Langy button that drafts that widget's prompt and opens it large", async () => {
      const user = userEvent.setup({ pointerEventsCheck: 0 });
      const { host } = openCurated({ templateId: "release" });
      const names = curatedBoardById("release")?.widgets.map(({ name }) => name) ?? [];

      await screen.findByRole("heading", { name: "Ready to ship?" });
      const asks = screen.getAllByRole("button", { name: /^Ask Langy about / });
      expect(asks.map((button) => button.getAttribute("aria-label") ?? "").toSorted()).toEqual(
        names.map((name) => `Ask Langy about ${name}`).toSorted(),
      );

      await user.click(asks[0]!);

      expect(host.langyAsks).toHaveLength(1);
      expect(host.langyAsks[0]?.question).toBeUndefined();
      expect(host.langyAsks[0]?.draft).toContain(names[0]);
      expect(host.langyAsks[0]?.context[0]?.ref).toContain("From LangWatch dashboard");
      expect(await screen.findByRole("dialog", { name: names[0] })).toBeInTheDocument();
      expect(host.lastQuery).not.toEqual(PICKER_OPEN);
      expect(screen.queryByRole("heading", { name: "Add a widget" })).toBeNull();
    });
  });

  describe("when Langy is off", () => {
    /** @scenario "AC120b Ask Langy: every widget on every board has Ask Langy, From LangWatch boards included" */
    it("shows no Ask Langy on any widget", async () => {
      openCurated({ templateId: "release", flags: { release_dashboards: true } });

      await screen.findByRole("heading", { name: "Ready to ship?" });
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

    /**
     * @scenario "From LangWatch: picking a widget makes a new dashboard with only that widget"
     * @scenario "Telemetry: making a board sends dashboards.created.dashboard with where it came from"
     */
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
      // The curated board is not the new board's context, so no draft is seeded;
      // let a stray one land.
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

    /** @scenario "From LangWatch: the picker waits for the member's dashboards to load" */
    it("shows the picker only once the saved boards have loaded, then numbers a taken name", async () => {
      const user = userEvent.setup({ pointerEventsCheck: 0 });
      const traffic = PICKER_QUESTIONS.find(({ id }) => id === "traffic")!;
      const widgetName = pickerWidgets(traffic.id)[0]!.name;
      let load = () => {};
      const boardsGate = new Promise<void>((resolve) => {
        load = resolve;
      });
      const { host, server } = openCurated({
        templateId: "breaks",
        storedNames: [widgetName],
        boardsGate,
        query: PICKER_OPEN,
      });

      await screen.findByRole("heading", { name: "Errors and failures" });
      await screen.findByRole("button", { name: "What do you want to know?" });
      await expect(
        screen.findByRole("heading", { name: "Add a widget" }, { timeout: 300 }),
      ).rejects.toThrow(/Unable to find/);
      expect(host.langyAsks).toEqual([]);
      load();

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

    /** @scenario "Telemetry: making a board sends dashboards.created.dashboard with where it came from" */
    it("sends nothing, goes nowhere and says so when the new dashboard cannot be made", async () => {
      const user = userEvent.setup({ pointerEventsCheck: 0 });
      const traffic = PICKER_QUESTIONS.find(({ id }) => id === "traffic")!;
      const { host } = openCurated({ templateId: "breaks", createFails: true, query: PICKER_OPEN });

      await user.click(
        await screen.findByRole("button", {
          name: (accessible) => accessible.startsWith(traffic.question),
        }),
      );

      await waitFor(() =>
        expect(host.failures).toEqual([
          expect.objectContaining({
            fallbackTitle: "Couldn't create the dashboard from the widget",
          }),
        ]),
      );
      expect(host.navigations).toEqual([]);
      expect(
        tracked.events.filter(({ name, action }) => name === "dashboard" && action === "created"),
      ).toEqual([]);
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

      await screen.findByRole("heading", { name: "Errors and failures" });
      await screen.findByRole("button", { name: "What do you want to know?" });
      expect(screen.queryByRole("heading", { name: "Add a widget" })).toBeNull();
    });
  });

  describe("when the address names no From LangWatch board", () => {
    /** @scenario "From LangWatch: a template board is live and offers every edit" */
    it("shows the not-found page", async () => {
      openCurated({ templateId: "nope" });

      expect(
        await screen.findByRole("heading", { name: "This page is not here" }),
      ).toBeInTheDocument();
    });
  });
});
