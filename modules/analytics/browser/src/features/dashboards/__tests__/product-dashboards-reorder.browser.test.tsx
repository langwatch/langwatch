/**
 * Reordering a product sidebar's Dashboards section in real Chromium: dnd-kit measures the rows
 * it sorts, and jsdom lays nothing out.
 * @see modules/dashboard/specs/dashboards-organization-area.feature
 */

import type { UiProcedureCall } from "@langwatch/browser/testing-transport";
import { cleanup, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, onTestFinished } from "vitest";

import { StubAnalyticsHost } from "../../../testing.tsx";
import { ProductDashboardsSection } from "../ui/sections/product-dashboards-section.tsx";
import { NO_PROCEDURES, renderDashboards } from "./render-dashboards.test-helpers.tsx";

afterEach(cleanup);

/** The project the stub host has in view. */
const IN_VIEW = { id: "proj-1", slug: "test-project", name: "Test Project" };

const board = ({
  id,
  name,
  createdById = "someone",
}: {
  id: string;
  name: string;
  createdById?: string;
}) => ({
  id,
  name,
  description: null,
  createdById,
  ownerName: null,
  scope: "ORGANIZATION",
  homeProduct: "llm-ops",
  updatedAt: new Date("2026-11-01"),
  project: IN_VIEW,
  openProject: IN_VIEW,
});

const LISTED = [
  board({ id: "mine", name: "My dashboard", createdById: "user-1" }),
  board({ id: "alpha", name: "Alpha" }),
  board({ id: "beta", name: "Beta" }),
  board({ id: "gamma", name: "Gamma" }),
];

/** A save answers once `until` resolves, or at once without it. */
type SaveAnswer = { isRefused: boolean; until?: Promise<void> };

/** A save answer the test releases by hand. */
const gate = () => {
  let release = () => {};
  const until = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { until, release };
};

function renderSection({
  saved = [],
  saveAnswers = [],
}: {
  saved?: readonly string[];
  /** How the nth save answers; a save past the list succeeds at once. */
  saveAnswers?: readonly SaveAnswer[];
} = {}) {
  const host = new StubAnalyticsHost();
  const calls: UiProcedureCall[] = [];
  let stored = saved;
  let saveCount = 0;
  const answer = (call: UiProcedureCall): Promise<unknown> => {
    calls.push(call);
    if (call.path === "boards.listInOrganization") return Promise.resolve(LISTED);
    if (call.path === "boards.listStarred") return Promise.resolve([]);
    if (call.path === "boards.storeProjects") return Promise.resolve([IN_VIEW]);
    if (call.path === "boards.getAll") return Promise.resolve([]);
    if (call.path === "boards.sidebarOrder") return Promise.resolve({ dashboardIds: stored });
    if (call.path === "boards.reorderSidebar") {
      const { isRefused, until } = saveAnswers[saveCount] ?? { isRefused: false };
      saveCount += 1;
      const dashboardIds = (call.input as { dashboardIds: readonly string[] }).dashboardIds;
      return (until ?? Promise.resolve()).then(() => {
        if (isRefused) throw new Error("refused");
        stored = dashboardIds;
        return { success: true };
      });
    }
    return NO_PROCEDURES(call);
  };
  const view = renderDashboards({
    element: (
      <div style={{ width: "260px" }}>
        <ProductDashboardsSection product="llm-ops" />
      </div>
    ),
    host,
    answer,
  });
  return { host, calls, view, user: userEvent.setup() };
}

const listed = async () => {
  const list = await screen.findByRole("list", { name: "Dashboards" });
  return within(list)
    .queryAllByRole("link")
    .map((link) => link.textContent);
};

const savedOrders = (calls: readonly UiProcedureCall[]) =>
  calls
    .filter((call) => call.path === "boards.reorderSidebar")
    .map((call) => (call.input as { dashboardIds: readonly string[] }).dashboardIds);

describe("a product's Dashboards section, reordered", () => {
  /** @scenario "Drag a board to reorder a product's Dashboards section" */
  it("moves a dragged row above another, saves it, and does not open the board", async () => {
    const { host, calls, user } = renderSection();
    await waitFor(async () =>
      expect(await listed()).toEqual(["My dashboard", "Alpha", "Beta", "Gamma"]),
    );
    expect(screen.queryByRole("button", { name: "Reorder My dashboard" })).toBeNull();

    const gamma = screen.getByRole("link", { name: "Gamma" });
    const alpha = screen.getByRole("link", { name: "Alpha" }).getBoundingClientRect();
    const from = gamma.getBoundingClientRect();
    const start = { x: from.left + 40, y: from.top + from.height / 2 };
    // Read once dispatch is over: a click left unprevented makes the browser follow the link.
    const dropClicks: boolean[] = [];
    const recordClick = (event: MouseEvent) =>
      setTimeout(() => dropClicks.push(event.defaultPrevented), 0);
    window.addEventListener("click", recordClick, { capture: true });
    onTestFinished(() => window.removeEventListener("click", recordClick, { capture: true }));
    await user.pointer([
      { keys: "[MouseLeft>]", target: gamma, coords: start },
      { target: gamma, coords: { x: start.x, y: start.y - 10 } },
      { target: gamma, coords: { x: start.x, y: alpha.top + 2 } },
      { target: gamma, coords: { x: start.x, y: alpha.top + 1 } },
    ]);
    await user.pointer({
      keys: "[/MouseLeft]",
      target: gamma,
      coords: { x: start.x, y: alpha.top + 1 },
    });

    await waitFor(async () =>
      expect(await listed()).toEqual(["My dashboard", "Gamma", "Alpha", "Beta"]),
    );
    await waitFor(() => expect(savedOrders(calls)).toEqual([["gamma", "alpha", "beta"]]));
    await waitFor(() => expect(dropClicks).toEqual([true]));
    expect(host.navigations).toEqual([]);
  });

  /** @scenario "Reorder a product's Dashboards section from the keyboard" */
  it("moves a row with Space and the arrows, announces it, and Escape cancels", async () => {
    const { calls, user } = renderSection();
    await waitFor(async () =>
      expect(await listed()).toEqual(["My dashboard", "Alpha", "Beta", "Gamma"]),
    );

    screen.getByRole("button", { name: "Reorder Beta" }).focus();
    await user.keyboard(" ");
    await user.keyboard("{ArrowUp}");
    await user.keyboard("{Escape}");

    expect(await listed()).toEqual(["My dashboard", "Alpha", "Beta", "Gamma"]);
    expect(savedOrders(calls)).toEqual([]);

    screen.getByRole("button", { name: "Reorder Gamma" }).focus();
    await user.keyboard(" ");
    await user.keyboard("{ArrowUp}");
    await user.keyboard("{ArrowUp}");
    await user.keyboard(" ");

    await waitFor(async () =>
      expect(await listed()).toEqual(["My dashboard", "Gamma", "Alpha", "Beta"]),
    );
    expect(savedOrders(calls)).toEqual([["gamma", "alpha", "beta"]]);
    await waitFor(() =>
      expect(screen.getAllByRole("status").map((region) => region.textContent)).toContain(
        "Dropped Gamma at Alpha's place.",
      ),
    );
  });

  /** @scenario "A reorder the server refuses puts back the last saved order" */
  it("puts the saved order back without a new read when the save fails", async () => {
    const { host, calls, user } = renderSection({
      saved: ["gamma", "alpha", "beta"],
      saveAnswers: [{ isRefused: true }],
    });
    await waitFor(async () =>
      expect(await listed()).toEqual(["My dashboard", "Gamma", "Alpha", "Beta"]),
    );
    const reads = () => calls.filter((call) => call.path === "boards.sidebarOrder").length;
    const readsBefore = reads();

    screen.getByRole("button", { name: "Reorder Beta" }).focus();
    await user.keyboard(" ");
    await user.keyboard("{ArrowUp}");
    await user.keyboard("{ArrowUp}");
    await user.keyboard(" ");

    await waitFor(() =>
      expect(host.failures).toEqual([
        expect.objectContaining({ fallbackTitle: "Couldn't save the order of your dashboards" }),
      ]),
    );
    expect(savedOrders(calls)).toEqual([["beta", "gamma", "alpha"]]);
    expect(await listed()).toEqual(["My dashboard", "Gamma", "Alpha", "Beta"]);
    expect(reads()).toBe(readsBefore);
  });

  /** Gamma up, then Alpha down, through the keyboard handles. */
  const moveTwice = async (user: ReturnType<typeof userEvent.setup>) => {
    screen.getByRole("button", { name: "Reorder Gamma" }).focus();
    await user.keyboard(" ");
    await user.keyboard("{ArrowUp}");
    await user.keyboard(" ");
    screen.getByRole("button", { name: "Reorder Alpha" }).focus();
    await user.keyboard(" ");
    await user.keyboard("{ArrowDown}");
    await user.keyboard(" ");
  };
  const flush = () => new Promise((resolve) => setTimeout(resolve, 50));

  /** @scenario "A reorder the server refuses puts back the last saved order" */
  it("keeps a later saved order when an earlier save is refused while it is out", async () => {
    const first = gate();
    const second = gate();
    const { host, calls, user } = renderSection({
      saved: ["alpha", "beta", "gamma"],
      saveAnswers: [
        { isRefused: true, until: first.until },
        { isRefused: false, until: second.until },
      ],
    });
    await waitFor(async () =>
      expect(await listed()).toEqual(["My dashboard", "Alpha", "Beta", "Gamma"]),
    );

    await moveTwice(user);
    first.release();

    await waitFor(() => expect(host.failures).toHaveLength(1));
    await waitFor(() => expect(savedOrders(calls)).toHaveLength(2));
    expect(savedOrders(calls)).toEqual([
      ["alpha", "gamma", "beta"],
      ["gamma", "alpha", "beta"],
    ]);
    // The later save is still out, so its order stays on screen.
    expect(await listed()).toEqual(["My dashboard", "Gamma", "Alpha", "Beta"]);
    second.release();
    await flush();
    expect(await listed()).toEqual(["My dashboard", "Gamma", "Alpha", "Beta"]);
  });

  /** @scenario "Quick reorders are saved in the order I made them" */
  it("sends a second order only after the first save is answered", async () => {
    const first = gate();
    const { calls, user } = renderSection({
      saved: ["alpha", "beta", "gamma"],
      saveAnswers: [{ isRefused: false, until: first.until }],
    });
    await waitFor(async () =>
      expect(await listed()).toEqual(["My dashboard", "Alpha", "Beta", "Gamma"]),
    );

    await moveTwice(user);

    expect(await listed()).toEqual(["My dashboard", "Gamma", "Alpha", "Beta"]);
    expect(savedOrders(calls)).toEqual([["alpha", "gamma", "beta"]]);
    first.release();
    await waitFor(() =>
      expect(savedOrders(calls)).toEqual([
        ["alpha", "gamma", "beta"],
        ["gamma", "alpha", "beta"],
      ]),
    );
    await flush();
    expect(await listed()).toEqual(["My dashboard", "Gamma", "Alpha", "Beta"]);
  });
});
