/**
 * @vitest-environment jsdom
 * The "Starred dashboards" group of the library's sidebar, over the real tRPC hooks and a
 * transport the test answers.
 * @see modules/dashboard/specs/dashboards-organization-area.feature
 */

import type { UiProcedureCall } from "@langwatch/browser/testing-transport";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { StubAnalyticsHost } from "../../../testing.tsx";
import { CURATED_BOARDS } from "../model/curated-boards.ts";
import { OrganizationStarredSection } from "../ui/sections/organization-starred-section.tsx";
import { NO_PROCEDURES, renderDashboards } from "./render-dashboards.test-helpers.tsx";

const SHOP = { id: "proj-shop", slug: "shop-abc123", name: "Shop" };
const [CURATED] = CURATED_BOARDS;

const board = ({ index, starPosition }: { index: number; starPosition: number | null }) => ({
  id: `board-${index}`,
  name: `Board ${index}`,
  description: null,
  createdById: "someone",
  ownerName: null,
  scope: "PROJECT",
  updatedAt: new Date("2026-11-01"),
  project: SHOP,
  openProject: SHOP,
  starPosition,
});

function renderGroup({ listed, templateIds = [] }: { listed: unknown[]; templateIds?: string[] }) {
  const answer = (call: UiProcedureCall): Promise<unknown> => {
    if (call.path === "boards.listInOrganization") return Promise.resolve(listed);
    if (call.path === "boards.listStarred") {
      return Promise.resolve(templateIds.map((templateId) => ({ kind: "template", templateId })));
    }
    return NO_PROCEDURES(call);
  };
  const host = new StubAnalyticsHost();
  renderDashboards({ element: <OrganizationStarredSection />, host, answer });
  return { user: userEvent.setup({ pointerEventsCheck: 0 }) };
}

const linkNames = (list: HTMLElement) =>
  within(list)
    .getAllByRole("link")
    .map((link) => link.textContent);

describe("the library sidebar's Starred dashboards group", () => {
  describe("given starred boards and a starred From LangWatch board", () => {
    /** @scenario "The Dashboards sidebar at org level" */
    it("lists the boards in the member's star order, then the From LangWatch one", async () => {
      renderGroup({
        listed: [
          board({ index: 1, starPosition: 1 }),
          board({ index: 2, starPosition: null }),
          board({ index: 3, starPosition: 0 }),
        ],
        templateIds: [CURATED?.templateId ?? ""],
      });

      const list = await screen.findByRole("list", { name: "Starred dashboards" });
      expect(linkNames(list)).toEqual(["Board 3", "Board 1", CURATED?.name]);
      expect(within(list).getByRole("link", { name: "Board 3" })).toHaveAttribute(
        "href",
        "/dashboards/board-3",
      );
      expect(within(list).queryByRole("button")).toBeNull();
    });
  });

  describe("given more stars than the group shows", () => {
    /** @scenario "Gateway, Coding agents and Governance list my starred dashboards" */
    it("lists 7, then All starred (N), which opens the library", async () => {
      renderGroup({
        listed: Array.from({ length: 9 }, (_, index) => board({ index, starPosition: index })),
      });

      const list = await screen.findByRole("list", { name: "Starred dashboards" });
      const names = linkNames(list);
      expect(names).toHaveLength(8);
      expect(names.at(-1)).toBe("All starred (9)");
      expect(within(list).getByRole("link", { name: "All starred (9)" })).toHaveAttribute(
        "href",
        "/dashboards",
      );
    });
  });

  describe("when the member folds the group", () => {
    it("hides its rows, and unfolding shows them again", async () => {
      const { user } = renderGroup({ listed: [board({ index: 1, starPosition: 0 })] });
      await screen.findByRole("link", { name: "Board 1" });

      await user.click(screen.getByRole("button", { name: "Collapse Starred dashboards" }));
      expect(screen.queryByRole("link", { name: "Board 1" })).toBeNull();

      await user.click(screen.getByRole("button", { name: "Expand Starred dashboards" }));
      expect(screen.getByRole("link", { name: "Board 1" })).toBeVisible();
    });
  });
});
