/**
 * @vitest-environment jsdom
 * The Dashboards section analytics lends the LLM Ops sidebar: the dashboards the member pinned
 * to the project as links into Dashboards, a "+" that makes a pinned dashboard and opens
 * "Add a widget" on it, and an "Add dashboard" item when nothing is pinned.
 * @see modules/navigation/specs/product-sidebars.feature
 */

import type { UiProcedureCall } from "@langwatch/browser/testing-transport";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";

import { StubAnalyticsHost } from "../../../testing.tsx";
import { CURATED_BOARDS } from "../model/curated-boards.ts";
import { StarredDashboardsSection } from "../ui/sections/starred-dashboards-section.tsx";
import { HOME_BOARD, NO_PROCEDURES, renderDashboards } from "./render-dashboards.test-helpers.tsx";

const LATENCY = {
  ...HOME_BOARD,
  id: "board-1",
  name: "Latency",
  order: 0,
  description: null,
  createdById: "user-1",
  isStarred: true,
  createdAt: new Date("2026-01-01"),
  updatedAt: new Date("2026-01-01"),
  _count: { graphs: 0 },
};

/** Viewing only: no analytics:create. */
const VIEWER = ["analytics:view"];

function renderSection({
  stars,
  fails = false,
  permissions,
  pinFails = false,
  gate = Promise.resolve(),
}: {
  stars: unknown[];
  fails?: boolean;
  permissions?: string[];
  pinFails?: boolean;
  /** Holds the create answer, so a second press lands while the first is still in flight. */
  gate?: Promise<void>;
}) {
  const host = new StubAnalyticsHost(permissions ? { permissions } : {});
  const calls: UiProcedureCall[] = [];
  const answer = (call: UiProcedureCall) => {
    calls.push(call);
    if (call.path === "boards.listStarred") {
      return fails ? Promise.reject(new Error("down")) : Promise.resolve(stars);
    }
    if (call.path === "boards.getAll") return Promise.resolve([]);
    if (call.path === "boards.create") {
      return gate.then(() => ({ ...LATENCY, id: "board-new" }));
    }
    if (call.path === "boards.star") {
      return pinFails ? Promise.reject(new Error("pin down")) : Promise.resolve({ success: true });
    }
    return NO_PROCEDURES(call);
  };
  renderDashboards({ element: <StarredDashboardsSection />, host, answer });
  return { host, calls };
}

const inputsTo = (calls: UiProcedureCall[], path: string) =>
  calls.filter((call) => call.path === path).map(({ input }) => input);

const section = async () => within(await screen.findByRole("region", { name: "Dashboards" }));

const starsOf = (count: number) =>
  Array.from({ length: count }, (_, index) => ({
    kind: "board",
    dashboard: { ...LATENCY, id: `board-${index}`, name: `Board ${index}` },
  }));

afterEach(cleanup);

describe("the LLM Ops sidebar's Dashboards section", () => {
  describe("given the member pinned a board and a From LangWatch board", () => {
    /** @scenario "The LLM Ops sidebar has a Dashboards section listing the pinned dashboards" */
    it("titles itself Dashboards, lists both in the member's order, and an entry opens it", async () => {
      const user = userEvent.setup();
      const { host } = renderSection({
        stars: [
          { kind: "board", dashboard: LATENCY },
          { kind: "template", templateId: "release" },
        ],
      });

      const group = await section();
      expect(group.getByText("Dashboards")).toBeInTheDocument();
      const release = CURATED_BOARDS.find(({ templateId }) => templateId === "release")!;
      await waitFor(() =>
        expect(group.getAllByRole("link").map((link) => link.textContent)).toEqual([
          "Latency",
          release.name,
        ]),
      );
      await user.click(group.getByRole("link", { name: "Latency" }));
      expect(host.navigations).toEqual(["/test-project/dashboards/board-1"]);
    });
  });

  describe("given the member pinned more than 7 boards", () => {
    /** @scenario "Pinned dashboards in the LLM Ops sidebar stop at 7" */
    it("lists 7 and an All pinned (N) row that opens Dashboards", async () => {
      const user = userEvent.setup();
      const { host } = renderSection({ stars: starsOf(9) });

      const group = await section();
      await waitFor(() =>
        expect(group.getAllByRole("link").map((link) => link.textContent)).toEqual([
          ...[0, 1, 2, 3, 4, 5, 6].map((index) => `Board ${index}`),
          "All pinned (9)",
        ]),
      );
      await user.click(group.getByRole("link", { name: "All pinned (9)" }));
      expect(host.navigations).toEqual(["/test-project/dashboards"]);
    });

    /** @scenario "Pinned dashboards in the LLM Ops sidebar stop at 7" */
    it("adds no All pinned row at 7 or fewer", async () => {
      renderSection({ stars: starsOf(7) });

      const group = await section();
      await waitFor(() => expect(group.getAllByRole("link")).toHaveLength(7));
      expect(group.queryByText(/^All pinned/)).toBeNull();
    });
  });

  describe("when the member presses the '+' on the Dashboards title", () => {
    /** @scenario "The Dashboards section's plus button makes a dashboard pinned to this project" */
    it("makes a board, pins it to the project and opens Add a widget on it", async () => {
      const user = userEvent.setup();
      const { host, calls } = renderSection({ stars: [{ kind: "board", dashboard: LATENCY }] });

      await user.click((await section()).getByRole("button", { name: "New dashboard" }));

      await waitFor(() =>
        expect(host.navigations).toEqual(["/test-project/dashboards/board-new?addBlock=open"]),
      );
      expect(inputsTo(calls, "boards.create")).toEqual([
        { projectId: "proj-1", name: "Untitled dashboard 1" },
      ]);
      expect(inputsTo(calls, "boards.star")).toEqual([
        { projectId: "proj-1", star: { kind: "board", dashboardId: "board-new" } },
      ]);
    });
  });

  describe("when the member presses the '+' twice in a row", () => {
    /** @scenario "A double click leaves exactly one dashboard" */
    it("makes one board, however fast the clicks come", async () => {
      const { host, calls } = renderSection({ stars: [{ kind: "board", dashboard: LATENCY }] });
      const plus = (await section()).getByRole("button", { name: "New dashboard" });

      fireEvent.click(plus);
      fireEvent.click(plus);

      await waitFor(() => expect(host.navigations).toHaveLength(1));
      expect(inputsTo(calls, "boards.create")).toHaveLength(1);
      expect(inputsTo(calls, "boards.star")).toHaveLength(1);
    });
  });

  describe("when the member double clicks Add dashboard", () => {
    /** @scenario "A double click leaves exactly one dashboard" */
    it("makes one board", async () => {
      const user = userEvent.setup();
      let release = () => {};
      const gate = new Promise<void>((resolve) => (release = resolve));
      const { host, calls } = renderSection({ stars: [], gate });
      const add = await (await section()).findByRole("button", { name: "Add dashboard" });

      await user.dblClick(add);
      release();

      await waitFor(() => expect(host.navigations).toHaveLength(1));
      expect(inputsTo(calls, "boards.create")).toHaveLength(1);
    });
  });

  describe("when the pin fails after the board is made", () => {
    /** @scenario "A failed pin leaves exactly one dashboard" */
    it("keeps the one board, opens it with Add a widget, and tells the member", async () => {
      const user = userEvent.setup();
      const { host, calls } = renderSection({ stars: [], pinFails: true });

      await user.click(await (await section()).findByRole("button", { name: "Add dashboard" }));

      await waitFor(() =>
        expect(host.navigations).toEqual(["/test-project/dashboards/board-new?addBlock=open"]),
      );
      expect(inputsTo(calls, "boards.create")).toHaveLength(1);
      expect(host.failures).toHaveLength(1);
    });
  });

  describe("given a member who may not create dashboards", () => {
    /** @scenario "The Dashboards section's plus button makes a dashboard pinned to this project" */
    it("offers no '+' beside the pinned boards", async () => {
      renderSection({ stars: [{ kind: "board", dashboard: LATENCY }], permissions: VIEWER });

      const group = await section();
      await waitFor(() => expect(group.getAllByRole("link")).toHaveLength(1));
      expect(group.queryByRole("button", { name: "New dashboard" })).toBeNull();
    });

    /** @scenario "A member who may not create dashboards causes no dashboard list read" */
    it("reads no board list for them, only their pins", async () => {
      const { calls } = renderSection({
        stars: [{ kind: "board", dashboard: LATENCY }],
        permissions: VIEWER,
      });

      await waitFor(() => expect(inputsTo(calls, "boards.listStarred")).toHaveLength(1));
      await (await section()).findByRole("link", { name: "Latency" });
      expect(inputsTo(calls, "boards.getAll")).toEqual([]);
    });

    /** @scenario "With nothing pinned, the Dashboards section offers an Add dashboard item" */
    it("draws nothing when they pinned none", async () => {
      const { calls } = renderSection({ stars: [], permissions: VIEWER });
      await waitFor(() => expect(inputsTo(calls, "boards.listStarred")).toHaveLength(1));

      await waitFor(() => expect(screen.queryByText("Dashboards")).toBeNull());
      expect(screen.queryByText("Add dashboard")).toBeNull();
    });
  });

  describe("given the member pinned nothing", () => {
    /** @scenario "With nothing pinned, the Dashboards section offers an Add dashboard item" */
    it("offers Add dashboard first, which does what the '+' does", async () => {
      const user = userEvent.setup();
      const { host, calls } = renderSection({ stars: [] });

      const group = await section();
      const add = await group.findByRole("button", { name: "Add dashboard" });
      expect(group.getAllByRole("listitem")[0]).toContainElement(add);
      await user.click(add);

      await waitFor(() =>
        expect(host.navigations).toEqual(["/test-project/dashboards/board-new?addBlock=open"]),
      );
      expect(inputsTo(calls, "boards.star")).toEqual([
        { projectId: "proj-1", star: { kind: "board", dashboardId: "board-new" } },
      ]);
    });

    /** @scenario "With nothing pinned, the Dashboards section offers an Add dashboard item" */
    it("offers no Add dashboard item once a board is pinned", async () => {
      renderSection({ stars: [{ kind: "board", dashboard: LATENCY }] });

      const group = await section();
      await waitFor(() => expect(group.getAllByRole("link")).toHaveLength(1));
      expect(group.queryByRole("button", { name: "Add dashboard" })).toBeNull();
    });
  });

  describe("given the pins cannot be read", () => {
    /** @scenario "With the pinned list unreadable, the Dashboards section keeps its title and plus and lists nothing" */
    it("keeps the title and the '+', and lists nothing", async () => {
      const { calls } = renderSection({ stars: [], fails: true });
      await waitFor(() => expect(inputsTo(calls, "boards.listStarred").length).toBeGreaterThan(0));

      const group = await section();
      expect(group.getByRole("button", { name: "New dashboard" })).toBeInTheDocument();
      expect(group.queryByRole("link")).toBeNull();
      expect(group.queryByRole("button", { name: "Add dashboard" })).toBeNull();
    });
  });
});
