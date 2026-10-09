/**
 * @vitest-environment jsdom
 * The templates finder screen against an in-memory dashboards server.
 * @see modules/dashboard/specs/dashboards-finder.feature
 */

import type { UiProcedureCall } from "@langwatch/browser/testing-transport";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";

import { renderWithAnalyticsHost, StubAnalyticsHost } from "../../../testing.tsx";
import {
  AGENT_KIND_CHIP_LABELS,
  CATALOGUE_TEMPLATES,
  TRUNK_PITCHES,
  TRUNK_QUESTIONS,
} from "../catalogue/index.ts";
import {
  finderPool,
  type PreviewWidget,
  TEMPLATE_LIBRARY,
  TEMPLATE_PREVIEW_IDS,
  templatePreviewSrc,
  templateSections,
} from "../model/template-library.ts";
import { TemplatePreview } from "../ui/blocks/template-preview.tsx";
import TemplatesLibraryScreen from "../ui/sections/templates-library.screen.tsx";
import { NO_PROCEDURES, renderDashboards } from "./render-dashboards.test-helpers.tsx";

/** Boards and widgets from memory; every call is kept. */
function inMemoryServer({ boards = [] }: { boards?: { id: string; name: string }[] } = {}) {
  const state = { calls: [] as UiProcedureCall[], boards: [...boards] };
  const answer = (call: UiProcedureCall): Promise<unknown> => {
    state.calls.push(call);
    const input = (call.input ?? {}) as Record<string, unknown>;
    switch (call.path) {
      case "dashboards.getAll":
        return Promise.resolve(
          state.boards.map((board) => ({
            ...board,
            description: null,
            createdById: "user-1",
            isStarred: false,
            updatedAt: new Date("2026-01-01"),
          })),
        );
      case "dashboards.create": {
        const board = { id: `board-${state.boards.length + 1}`, name: String(input.name) };
        state.boards.push(board);
        return Promise.resolve(board);
      }
      case "dashboards.updateDetails":
      case "dashboardWidgets.batchUpdateLayouts":
        return Promise.resolve({ success: true });
      case "dashboardWidgets.create":
        return Promise.resolve({ id: `widget-${state.calls.length}` });
      default:
        return NO_PROCEDURES(call);
    }
  };
  return { state, answer };
}

const LANGY_ON = { release_dashboards: true, release_langy_enabled: true };
const LANGY_MEMBER = ["analytics:view", "cost:view", "traces:view", "langy:create"];
const POOL = finderPool({});
const READY = POOL[0]!.board;

function openLibrary({
  query = {},
  flags = { release_dashboards: true },
  permissions,
  boards,
}: {
  query?: Record<string, string>;
  flags?: Record<string, boolean>;
  permissions?: string[];
  boards?: { id: string; name: string }[];
} = {}) {
  const server = inMemoryServer({ boards });
  const host = new StubAnalyticsHost({ flags, permissions, route: { params: {}, query } });
  renderDashboards({ element: <TemplatesLibraryScreen />, host, answer: server.answer });
  return { host, server };
}

/** One chip in a row, by its words; its name ends with its count. */
const chip = ({ row, name }: { row: string; name: string }) =>
  within(screen.getByRole("group", { name: row })).getByRole("button", {
    name: new RegExp(`^${name}\\s*\\d+$`),
  });

afterEach(cleanup);

describe("the templates finder", () => {
  describe("given the release_dashboards flag is off", () => {
    /** @scenario "AC100b Templates library: the library is behind the dashboards gate" */
    it("shows the not-found page", () => {
      openLibrary({ flags: { release_dashboards: false } });

      expect(screen.getByRole("heading", { name: "This page is not here" })).toBeInTheDocument();
    });
  });

  describe("given no search and no filters", () => {
    /** @scenario "AC101 Templates library: every ready template is listed by trunk" */
    it("lists every ready template once, under its trunk, in trunk order", () => {
      openLibrary();

      expect(screen.getByRole("heading", { level: 1, name: "Dashboard templates" })).toBeVisible();
      const regions = screen.getAllByRole("region");
      expect(
        regions.map((region) => within(region).getByRole("heading", { level: 2 }).textContent),
      ).toEqual(templateSections({ templates: POOL }).map(({ key }) => key));
      expect(screen.getAllByRole("article")).toHaveLength(POOL.length);
    });

    /** @scenario "AC103 Templates library: one category chip and one agent-type chip narrow the finder" */
    it("offers All and the four categories, and agent types with no Any agent and no coding", () => {
      openLibrary();

      expect(chip({ row: "Categories", name: "All" })).toHaveAttribute("aria-pressed", "true");
      for (const trunk of ["Grow", "Protect", "Profit", "Trust"]) {
        expect(chip({ row: "Categories", name: trunk })).toHaveAttribute("aria-pressed", "false");
      }
      const types = within(screen.getByRole("group", { name: "Agent types" }));
      expect(types.getByRole("button", { name: /^Voice agent\s*\d+$/ })).toBeInTheDocument();
      expect(types.queryByRole("button", { name: /^Any agent/ })).toBeNull();
      expect(types.queryByRole("button", { name: /^Coding agent/ })).toBeNull();
    });
  });

  describe("given templates that are not built yet or belong elsewhere", () => {
    /** @scenario "Finder: coming-soon, coding-agent and org-wide templates are hidden" */
    it("lists none of them", () => {
      openLibrary();

      const names = screen.getAllByRole("article").map((card) => card.getAttribute("aria-label"));
      const comingSoon = TEMPLATE_LIBRARY.filter(({ board }) => board.comingSoon !== void 0);
      const elsewhere = CATALOGUE_TEMPLATES.filter(
        ({ scope, focusKind }) => scope === "org" || focusKind === "coding",
      );
      expect(elsewhere.length).toBeGreaterThan(0);
      for (const { name } of [...comingSoon.map(({ board }) => board), ...elsewhere]) {
        expect(names, name).not.toContain(name);
      }
    });
  });

  describe("given an address with a category picked", () => {
    /** @scenario "Finder: a picked category turns the header into its question and pitch" */
    it("opens on that category, with its question and what it is for as the header", () => {
      openLibrary({ query: { trunk: "Protect" } });

      expect(screen.getAllByRole("region")).toHaveLength(1);
      expect(chip({ row: "Categories", name: "Protect" })).toHaveAttribute("aria-pressed", "true");
      expect(
        screen.getByRole("heading", { level: 1, name: TRUNK_QUESTIONS.Protect }),
      ).toBeInTheDocument();
      expect(screen.getByText(TRUNK_PITCHES.Protect)).toBeInTheDocument();
    });

    /** @scenario "AC103 Templates library: one category chip and one agent-type chip narrow the finder" */
    it("clears the category when its chip is clicked again", async () => {
      const user = userEvent.setup();
      const { host } = openLibrary({ query: { trunk: "Protect" } });

      await user.click(chip({ row: "Categories", name: "Protect" }));

      expect(host.lastQuery).toMatchObject({ trunk: undefined });
    });
  });

  describe("given an address with an agent type picked", () => {
    /** @scenario "Finder: an agent-type chip finds only the templates made for that type" */
    it("lists only the templates made for that type, each naming it in its footer", () => {
      openLibrary({ query: { agent: "voice" } });

      const voice = finderPool({ agentKind: "voice" });
      const cards = screen.getAllByRole("article");
      expect(cards.map((card) => card.getAttribute("aria-label"))).toEqual(
        templateSections({ templates: voice }).flatMap(({ items }) =>
          items.map(({ board }) => board.name),
        ),
      );
      for (const card of cards) {
        expect(within(card).getByText(AGENT_KIND_CHIP_LABELS.voice)).toBeInTheDocument();
      }
    });
  });

  describe("given an agent type with nothing in a category", () => {
    /** @scenario "Finder: a category chip with nothing in it is not shown" */
    it("shows no chip for that category, and no chip anywhere reads 0", () => {
      openLibrary({ query: { agent: "voice" } });

      const categories = within(screen.getByRole("group", { name: "Categories" }));
      expect(categories.queryByRole("button", { name: /^Trust/ })).toBeNull();
      for (const button of screen.getAllByRole("button", { pressed: false })) {
        expect(button.textContent ?? "").not.toMatch(/\D0$/);
      }
    });
  });

  describe("when the member searches and picks chips", () => {
    /** @scenario "AC104 Templates library: the search and filters are kept in the address" */
    it("writes the search, the category and the agent type into the address", async () => {
      const user = userEvent.setup();
      const { host } = openLibrary();

      fireEvent.change(screen.getByRole("searchbox", { name: "Search templates" }), {
        target: { value: "cost" },
      });
      expect(host.lastQuery).toMatchObject({ q: "cost" });

      await user.click(chip({ row: "Categories", name: "Profit" }));
      expect(host.lastQuery).toMatchObject({ trunk: "Profit" });

      await user.click(chip({ row: "Agent types", name: AGENT_KIND_CHIP_LABELS.voice }));
      expect(host.lastQuery).toMatchObject({ agent: "voice" });
    });
  });

  describe("given a search that matches no template", () => {
    /** @scenario "AC105 Templates library: no match says so and offers to clear the filters" */
    it("says so and clears the search and filters", async () => {
      const user = userEvent.setup();
      const { host } = openLibrary({ query: { q: "zzz-no-such-template", trunk: "Profit" } });

      expect(screen.getByText("No template matches your search and filters.")).toBeInTheDocument();
      await user.click(screen.getByRole("button", { name: "Clear search and filters" }));

      expect(host.lastQuery).toEqual({ q: undefined, trunk: undefined, agent: undefined });
    });
  });

  describe("when the member adds a template", () => {
    /** @scenario "AC106 Templates library: a template creates a board for the whole project" */
    it("makes a board named after the template, and opens it", async () => {
      const user = userEvent.setup();
      const { host, server } = openLibrary();

      await user.click(screen.getByRole("button", { name: `Add ${READY.name} to this project` }));

      await waitFor(() => expect(host.navigations).toEqual(["/test-project/dashboards/board-1"]));
      const created = server.state.calls.find(({ path }) => path === "dashboards.create");
      expect(created?.input).toEqual({ projectId: "proj-1", name: READY.name });
    });

    /** @scenario "AC140 Template pick: the new board opens with the template's report drafted in Langy" */
    it("drafts the template's report in Langy, unsent, with the new board attached", async () => {
      const user = userEvent.setup();
      const { host } = openLibrary({ flags: LANGY_ON, permissions: LANGY_MEMBER });

      await user.click(screen.getByRole("button", { name: `Add ${READY.name} to this project` }));

      await waitFor(() => expect(host.langyAsks).toHaveLength(1));
      const [ask] = host.langyAsks;
      expect(ask?.question).toBeUndefined();
      expect(ask?.draft?.startsWith(READY.reportPrompt!)).toBe(true);
      expect(ask?.draft).toContain("Dashboard period:");
      expect(ask?.context[0]?.ref).toContain(`dashboard "${READY.name}" (id board-1)`);
      expect(ask?.context[0]?.ref).toContain(READY.widgets[0]!.name);
    });

    /** @scenario "AC140b Template pick: without Langy the board is made and nothing is drafted" */
    it("makes and opens the board but drafts nothing when Langy is not available", async () => {
      const user = userEvent.setup();
      const { host } = openLibrary();

      await user.click(screen.getByRole("button", { name: `Add ${READY.name} to this project` }));

      await waitFor(() => expect(host.navigations).toEqual(["/test-project/dashboards/board-1"]));
      expect(host.langyAsks).toEqual([]);
    });
  });

  describe("given this project already has a board made from a template", () => {
    const ADDED = { id: "board-9", name: `${READY.name} 2` };

    /** @scenario "AC145 Template card: a template already added shows Added, linking to its board" */
    it("shows Added as a link to that board instead of the add button", async () => {
      const user = userEvent.setup();
      const { host } = openLibrary({ boards: [ADDED] });
      const card = screen.getByRole("article", { name: READY.name });

      const added = await within(card).findByRole("link", {
        name: `${READY.name} is added: open its board`,
      });
      expect(added).toHaveAttribute("href", "/test-project/dashboards/board-9");
      expect(added).toHaveTextContent("Added");
      expect(within(card).queryByRole("button", { name: / to this project$/ })).toBeNull();

      await user.click(added);
      expect(host.navigations).toEqual(["/test-project/dashboards/board-9"]);
    });
  });

  describe("given a template's card", () => {
    /**
     * @scenario "AC107c Templates library: each card reads like the prototype's"
     * @scenario "AC144 Template card: the primary button reads Add to this project"
     */
    it("shows the name, the job, the widget count, Add to this project and the category, in order", () => {
      openLibrary();

      const card = screen.getByRole("article", { name: READY.name });
      const name = within(card).getByRole("heading", { level: 3, name: READY.name });
      const job = within(card).getByText(READY.description);
      const count = within(card).getByText(`${POOL[0]!.widgetCount} widgets`);
      const create = within(card).getByRole("button", {
        name: `Add ${READY.name} to this project`,
      });
      expect(create).toHaveTextContent("Add to this project");
      const trunk = POOL[0]!.trunk;
      const category = card.querySelector(`[data-trunk-badge="${trunk}"]`)!;
      expect(category).toHaveTextContent(`${trunk}: ${TRUNK_QUESTIONS[trunk]}`);
      const order = [name, job, count, create, category];
      for (const [index, element] of order.slice(1).entries()) {
        expect(
          order[index]!.compareDocumentPosition(element) & Node.DOCUMENT_POSITION_FOLLOWING,
        ).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
      }
      expect(within(card).queryByText(/coming soon/i)).toBeNull();
      expect(within(card).queryByRole("button", { name: /^Filter by/ })).toBeNull();
    });
  });

  describe("given a card's category icon", () => {
    /** @scenario "Template card: the category icon names its category and description on hover and focus" */
    it("shows the category and its one-line description on hover and on focus", async () => {
      const user = userEvent.setup();
      openLibrary();

      const card = screen.getByRole("article", { name: READY.name });
      const trunk = POOL[0]!.trunk;
      const badge = card.querySelector<HTMLElement>(`[data-trunk-badge="${trunk}"]`)!;
      const tip = `${trunk}: ${TRUNK_QUESTIONS[trunk]}`;

      await user.hover(badge);
      expect(await screen.findByRole("tooltip")).toHaveTextContent(tip);
      await user.unhover(badge);
      await waitFor(() => expect(screen.queryByRole("tooltip")).toBeNull());

      // Tab to it: only keyboard focus opens a tooltip.
      for (let presses = 0; presses < 40 && document.activeElement !== badge; presses++) {
        await user.tab();
      }
      expect(badge).toHaveFocus();
      expect(await screen.findByRole("tooltip")).toHaveTextContent(tip);
    });
  });

  describe("given the cards' previews", () => {
    /** @scenario "AC107d Templates library: a card previews the template's real board" */
    it("shows the captured image of a template that has one, hidden from assistive tech", () => {
      openLibrary();

      const captured = POOL.filter(({ board }) => TEMPLATE_PREVIEW_IDS.has(board.id));
      expect(captured.length).toBeGreaterThan(0);
      for (const { board } of captured) {
        const image = screen.getByRole("article", { name: board.name }).querySelector("img");
        expect(image?.getAttribute("src"), board.id).toBe(
          templatePreviewSrc({ templateId: board.id, theme: "light" }),
        );
        expect(image?.closest("[aria-hidden='true']"), board.id).not.toBeNull();
      }
    });

    /** @scenario "AC107d Templates library: a card previews the template's real board" */
    it("sketches a template with no image as blocks for its widgets, with no image and no text", () => {
      // Every template in the pool has a captured image now, so the sketch is rendered directly.
      const widgets: PreviewWidget[] = [
        {
          key: "left",
          title: "Left",
          placeholder: "tile",
          layout: { gridColumn: 0, gridRow: 0, colSpan: 4, rowSpan: 3 },
        },
        {
          key: "right",
          title: "Right",
          placeholder: "line",
          layout: { gridColumn: 4, gridRow: 0, colSpan: 4, rowSpan: 3 },
        },
      ];
      const { container } = renderWithAnalyticsHost(
        <TemplatePreview preview={{ kind: "layout", widgets }} />,
      );

      expect(container.querySelector("img")).toBeNull();
      const blocks = [...container.querySelectorAll("[data-sketch-widget]")];
      expect(blocks.map((block) => block.getAttribute("data-sketch-widget"))).toEqual([
        "left",
        "right",
      ]);
      for (const block of blocks) {
        expect(block.closest("[aria-hidden='true']")).not.toBeNull();
        expect(block.textContent).toBe("");
      }
    });
  });
});
