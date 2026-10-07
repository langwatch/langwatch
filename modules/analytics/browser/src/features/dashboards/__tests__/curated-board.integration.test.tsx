/**
 * @vitest-environment jsdom
 * A From LangWatch board: a template shown live and read-only, stored nowhere, whose
 * widgets with no query yet say so instead of showing numbers.
 * @see modules/dashboard/specs/dashboards-v2.feature
 */

import type { UiProcedureCall } from "@langwatch/browser/testing-transport";
import { cleanup, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";

import { StubAnalyticsHost } from "../../../testing.tsx";
import CuratedBoardScreen from "../ui/sections/curated-board.screen.tsx";
import { NO_PROCEDURES, renderDashboards } from "./render-dashboards.test-helpers.tsx";

const LANGY_ON = { release_dashboards: true, release_langy_enabled: true };
const MEMBER = ["analytics:view", "cost:view", "traces:view", "langy:create"];
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

function openCurated(templateId: string) {
  const server = readOnlyServer();
  const host = new StubAnalyticsHost({
    flags: LANGY_ON,
    permissions: MEMBER,
    route: { params: { templateId } },
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

  describe("when the board has widgets with no query yet", () => {
    /** @scenario "From LangWatch: a widget with no query yet shows as not built, with no numbers" */
    it("shows each as not built yet", async () => {
      openCurated("data");

      expect(
        await screen.findByRole("heading", { name: "Can I trust my numbers?" }),
      ).toBeInTheDocument();
      expect(screen.getAllByText("Not built yet")).toHaveLength(3);
    });
  });

  describe("when the member asks Langy from its bar", () => {
    /** @scenario "From LangWatch: a template board asks Langy with the board as context" */
    it("asks about the template board", async () => {
      const user = userEvent.setup();
      const { host } = openCurated("breaks");

      await user.click(await screen.findByRole("button", { name: "Ask" }));

      expect(host.langyAsks).toHaveLength(1);
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
