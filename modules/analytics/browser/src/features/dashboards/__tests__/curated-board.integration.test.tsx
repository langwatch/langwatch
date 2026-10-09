/**
 * @vitest-environment jsdom
 * A From LangWatch board: a template shown live and read-only, stored nowhere, whose
 * widgets with no query yet say so instead of showing numbers, and whose every widget
 * offers Ask Langy when Langy is available.
 * @see modules/dashboard/specs/dashboards-v2.feature
 */

import type { UiProcedureCall } from "@langwatch/browser/testing-transport";
import { cleanup, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";

import { ANALYTICS_MEMBER_PERMISSIONS, StubAnalyticsHost } from "../../../testing.tsx";
import { curatedBoardById } from "../model/curated-boards.ts";
import CuratedBoardScreen from "../ui/sections/curated-board.screen.tsx";
import { NO_PROCEDURES, renderDashboards } from "./render-dashboards.test-helpers.tsx";

const LANGY_ON = { release_dashboards: true, release_langy_enabled: true };
const MEMBER = [...ANALYTICS_MEMBER_PERMISSIONS, "langy:create"];
const WRITES = /^dashboards\.(?!getAll|listStarred|sourcePresence)|^dashboardWidgets\.(?!list)/;

/** No stored boards; every call is kept, so a write would show. */
function readOnlyServer() {
  const calls: UiProcedureCall[] = [];
  const answer = (call: UiProcedureCall): Promise<unknown> => {
    calls.push(call);
    if (call.path === "dashboards.getAll" || call.path === "dashboards.listStarred") {
      return Promise.resolve([]);
    }
    return NO_PROCEDURES(call);
  };
  return { calls, answer };
}

function openCurated(templateId: string, flags: Record<string, boolean> = LANGY_ON) {
  const server = readOnlyServer();
  const host = new StubAnalyticsHost({
    flags,
    permissions: MEMBER,
    route: { params: { templateId }, query: {} },
  });
  renderDashboards({ element: <CuratedBoardScreen />, host, answer: server.answer });
  return { host, server };
}

afterEach(cleanup);

describe("given a member opens a From LangWatch board", () => {
  /** @scenario "From LangWatch: a template board is live and read-only" */
  it("shows the template badged, offering Duplicate to edit and no way to change it", async () => {
    const { server } = openCurated("release");

    expect(await screen.findByRole("heading", { name: "Release check" })).toBeInTheDocument();
    expect(screen.getByText("From LangWatch")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Duplicate to edit" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Add a widget" })).toBeNull();
    expect(screen.queryByRole("button", { name: /^Actions for / })).toBeNull();
    expect(server.calls.filter(({ path }) => WRITES.test(path))).toEqual([]);
  });

  describe("when the board is Can I trust my numbers?", () => {
    /** @scenario "From LangWatch: every widget on a template board has code" */
    it("shows its four widgets and no placeholder", async () => {
      openCurated("data");

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
      const { host } = openCurated("release");
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
      openCurated("release", { release_dashboards: true });

      await screen.findByRole("heading", { name: "Release check" });
      expect(screen.queryByRole("button", { name: /^Ask Langy about / })).toBeNull();
    });
  });

  describe("when the member clicks its ask bar", () => {
    /** @scenario "From LangWatch: a template board asks Langy with the board as context" */
    it("opens Langy about the template board with nothing asked yet", async () => {
      const user = userEvent.setup();
      const { host } = openCurated("breaks");

      await user.click(await screen.findByRole("button", { name: "What do you want to know?" }));

      expect(host.langyAsks).toHaveLength(1);
      expect(host.langyAsks[0]?.question).toBeUndefined();
      expect(host.langyAsks[0]?.context[0]?.ref).toContain("From LangWatch dashboard");
    });
  });

  describe("when the address names no From LangWatch board", () => {
    /** @scenario "From LangWatch: a template board is live and read-only" */
    it("shows the not-found page", async () => {
      openCurated("nope");

      expect(
        await screen.findByRole("heading", { name: "This page is not here" }),
      ).toBeInTheDocument();
    });
  });
});
