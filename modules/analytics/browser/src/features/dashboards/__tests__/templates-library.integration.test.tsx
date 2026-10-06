/**
 * @vitest-environment jsdom
 * The templates library screen against an in-memory dashboards server.
 * @see modules/dashboard/specs/dashboards-v2.feature
 */

import type { UiProcedureCall } from "@langwatch/browser-host/testing-transport";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";

import { StubAnalyticsHost } from "../../../testing.tsx";
import { AGENT_KIND_LABELS } from "../catalogue/index.ts";
import {
  TEMPLATE_LIBRARY,
  TEMPLATE_PREVIEW_IDS,
  templatePreviewSrc,
} from "../model/template-library.ts";
import TemplatesLibraryScreen from "../ui/sections/templates-library.screen.tsx";
import { NO_PROCEDURES, renderDashboards } from "./render-dashboards.test-helpers.tsx";

/** Boards and widgets from memory; every call is kept. */
function inMemoryServer() {
  const state = { calls: [] as UiProcedureCall[], boards: [] as { id: string; name: string }[] };
  const answer = (call: UiProcedureCall): Promise<unknown> => {
    state.calls.push(call);
    const input = (call.input ?? {}) as Record<string, unknown>;
    switch (call.path) {
      case "dashboards.getAll":
        return Promise.resolve(
          state.boards.map((board) => ({
            ...board,
            description: null,
            visibility: "only_me",
            createdById: "user-1",
          })),
        );
      case "dashboards.create": {
        const board = { id: `board-${state.boards.length + 1}`, name: String(input.name) };
        state.boards.push(board);
        return Promise.resolve({ ...board, visibility: input.visibility });
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

function openLibrary({
  query = {},
  flags = { release_dashboards: true },
}: {
  query?: Record<string, string>;
  flags?: Record<string, boolean>;
} = {}) {
  const server = inMemoryServer();
  const host = new StubAnalyticsHost({ flags, route: { params: {}, query } });
  renderDashboards({ element: <TemplatesLibraryScreen />, host, answer: server.answer });
  return { host, server };
}

afterEach(cleanup);

describe("the templates library", () => {
  describe("given the release_dashboards flag is off", () => {
    /** @scenario "AC100b Templates library: the library is behind the dashboards gate" */
    it("shows the not-found page", () => {
      openLibrary({ flags: { release_dashboards: false } });

      expect(screen.getByRole("heading", { name: "This page is not here" })).toBeInTheDocument();
    });
  });

  describe("given no search and no filters", () => {
    /** @scenario "AC101 Templates library: every template is listed by trunk, ready ones first" */
    it("lists every template once, under its trunk, in trunk order", () => {
      openLibrary();

      expect(screen.getByRole("heading", { name: "Dashboard templates" })).toBeInTheDocument();
      const regions = screen.getAllByRole("region");
      expect(
        regions.map((region) => within(region).getByRole("heading", { level: 2 }).textContent),
      ).toEqual(["Profit", "Growth", "Protect", "Foundation"]);
      expect(screen.getAllByRole("article")).toHaveLength(TEMPLATE_LIBRARY.length);
    });
  });

  describe("given an address with a trunk chip picked", () => {
    /** @scenario "AC104 Templates library: the search and filters are kept in the address" */
    it("opens on that view, with the chip pressed", () => {
      openLibrary({ query: { trunk: "Protect" } });

      expect(screen.getAllByRole("region")).toHaveLength(1);
      const trunks = screen.getByRole("group", { name: "Filter by trunk" });
      expect(within(trunks).getByRole("button", { name: /^Protect/ })).toHaveAttribute(
        "aria-pressed",
        "true",
      );
    });
  });

  describe("when the member searches and picks a chip", () => {
    /** @scenario "AC104 Templates library: the search and filters are kept in the address" */
    it("writes the search and the chip into the address", async () => {
      const user = userEvent.setup();
      const { host } = openLibrary();

      fireEvent.change(screen.getByRole("searchbox", { name: "Search templates" }), {
        target: { value: "cost" },
      });
      expect(host.lastQuery).toMatchObject({ q: "cost" });

      const readiness = screen.getByRole("group", { name: "Filter by readiness" });
      await user.click(within(readiness).getByRole("button", { name: /^Ready/ }));
      expect(host.lastQuery).toMatchObject({ status: "ready" });
    });
  });

  describe("given a search that matches no template", () => {
    /** @scenario "AC105 Templates library: no match says so and offers to clear the filters" */
    it("says so and clears the search and filters", async () => {
      const user = userEvent.setup();
      const { host } = openLibrary({ query: { q: "zzz-no-such-template", trunk: "Profit" } });

      expect(screen.getByText("No template matches your search and filters.")).toBeInTheDocument();
      await user.click(screen.getByRole("button", { name: "Clear search and filters" }));

      expect(host.lastQuery).toEqual({
        q: undefined,
        trunk: undefined,
        agent: undefined,
        status: undefined,
      });
    });
  });

  describe("when the member creates a board from a ready template", () => {
    const READY = TEMPLATE_LIBRARY.find(({ status }) => status === "ready")!.board;

    /** @scenario "AC106 Templates library: a ready template creates a board, a coming-soon one cannot" */
    it("makes a board only they see, named after the template, and opens it", async () => {
      const user = userEvent.setup();
      const { host, server } = openLibrary();

      await user.click(screen.getByRole("button", { name: `Create a board from ${READY.name}` }));

      await waitFor(() => expect(host.navigations).toEqual(["/test-project/dashboards/board-1"]));
      const created = server.state.calls.find(({ path }) => path === "dashboards.create");
      expect(created?.input).toMatchObject({ name: READY.name, visibility: "only_me" });
    });
  });

  describe("given a coming-soon template", () => {
    const SOON = TEMPLATE_LIBRARY.find(({ status }) => status === "coming-soon")!.board;

    /** @scenario "AC106 Templates library: a ready template creates a board, a coming-soon one cannot" */
    it("says how far it is built and cannot create a board", () => {
      openLibrary();

      const card = screen.getByRole("article", { name: SOON.name });
      expect(
        within(card).getByText(
          `Coming soon: ${SOON.comingSoon?.built} of ${SOON.comingSoon?.total} widgets built`,
        ),
      ).toBeInTheDocument();
      expect(
        within(card).getByRole("button", { name: `Create a board from ${SOON.name}` }),
      ).toBeDisabled();
    });
  });

  describe("given a ready template's card", () => {
    const READY = TEMPLATE_LIBRARY.find(({ status }) => status === "ready")!;

    /** @scenario "AC107c Templates library: each card reads like the prototype's" */
    it("shows the name with its trunk badge, the job, the labels and Create board, in order", () => {
      openLibrary();

      const card = screen.getByRole("article", { name: READY.board.name });
      const name = within(card).getByRole("heading", { level: 3, name: READY.board.name });
      const badge = within(card).getByRole("button", { name: `Filter by ${READY.trunk}` });
      const create = within(card).getByRole("button", {
        name: `Create a board from ${READY.board.name}`,
      });
      const order = [name, badge, create];
      for (const [index, element] of order.slice(1).entries()) {
        const before = order[index]!;
        expect(before.compareDocumentPosition(element) & Node.DOCUMENT_POSITION_FOLLOWING).toBe(
          Node.DOCUMENT_POSITION_FOLLOWING,
        );
      }
      expect(within(card).getByText(`${READY.widgetCount} widgets`)).toBeInTheDocument();
    });
  });

  describe("given the cards' previews", () => {
    const sketched = TEMPLATE_LIBRARY.flatMap(({ board, preview }) =>
      preview.kind === "layout" ? [{ board, widgets: preview.widgets }] : [],
    );

    /** @scenario "AC107d Templates library: a card previews the template's real board" */
    it("shows the captured image of a template that has one, hidden from assistive tech", () => {
      openLibrary();

      const captured = TEMPLATE_LIBRARY.filter(({ board }) => TEMPLATE_PREVIEW_IDS.has(board.id));
      expect(captured.length).toBeGreaterThan(0);
      for (const { board } of captured) {
        const image = screen.getByRole("article", { name: board.name }).querySelector("img");
        expect(image?.getAttribute("src"), board.id).toBe(templatePreviewSrc(board.id));
        expect(image?.closest("[aria-hidden='true']"), board.id).not.toBeNull();
      }
    });

    /** @scenario "AC107d Templates library: a card previews the template's real board" */
    it("sketches every other template's widget titles, with no image", () => {
      openLibrary();

      expect(sketched.length).toBeGreaterThan(0);
      for (const { board, widgets } of sketched) {
        const card = screen.getByRole("article", { name: board.name });
        expect(card.querySelector("img"), board.id).toBeNull();
        for (const { title } of widgets) {
          const [shown] = within(card).getAllByText(title);
          expect(shown?.closest("[aria-hidden='true']"), title).not.toBeNull();
        }
      }
    });
  });

  describe("when the member clicks a card's labels", () => {
    const VOICE = TEMPLATE_LIBRARY.find(({ agentKinds }) => agentKinds.includes("voice"))!;
    const voice = AGENT_KIND_LABELS.voice;

    /** @scenario "AC107e Templates library: a card's trunk and agent kind labels filter the library" */
    it("writes the agent kind and the trunk into the address, as the chips do", async () => {
      const user = userEvent.setup();
      const { host } = openLibrary();
      const card = screen.getByRole("article", { name: VOICE.board.name });

      await user.click(within(card).getByRole("button", { name: `Filter by ${voice}` }));
      expect(host.lastQuery).toMatchObject({ agent: "voice" });

      await user.click(within(card).getByRole("button", { name: `Filter by ${VOICE.trunk}` }));
      expect(host.lastQuery).toMatchObject({ trunk: VOICE.trunk });
    });

    /** @scenario "AC107e Templates library: a card's trunk and agent kind labels filter the library" */
    it("shows a picked label as on, and clicking it again clears that chip", async () => {
      const user = userEvent.setup();
      const { host } = openLibrary({ query: { agent: "voice" } });
      const card = screen.getByRole("article", { name: VOICE.board.name });
      const label = within(card).getByRole("button", { name: `Filter by ${voice}` });

      expect(label).toHaveAttribute("aria-pressed", "true");
      label.focus();
      await user.keyboard("{Enter}");

      expect(host.lastQuery).toMatchObject({ agent: undefined });
    });
  });
});
