/**
 * A product sidebar's Dashboards section: which boards it lists, in which group and order.
 * @see modules/dashboard/specs/dashboards-organization-area.feature
 */

import { describe, expect, it } from "vitest";

import { CURATED_BOARDS } from "../model/curated-boards.ts";
import type { LibraryBoard } from "../model/organization-library.ts";
import { productSidebarBoards, sharingTitle } from "../model/product-dashboards.ts";

const SHOP = { id: "proj-shop", slug: "shop", name: "Shop" };
const OPS = { id: "proj-ops", slug: "ops", name: "Ops" };
const ME = "user-me";

const board = (overrides: Partial<LibraryBoard> & Pick<LibraryBoard, "id">): LibraryBoard => ({
  name: overrides.id,
  description: null,
  createdById: "someone",
  ownerName: null,
  scope: "ORGANIZATION",
  homeProduct: "gateway",
  project: SHOP,
  openProject: SHOP,
  ...overrides,
});

const groupsOf = (
  boards: readonly LibraryBoard[],
  extra: { product?: LibraryBoard["homeProduct"]; projectId?: string | undefined } = {},
) =>
  productSidebarBoards({
    boards,
    product: extra.product ?? "gateway",
    userId: ME,
    curated: CURATED_BOARDS,
    projectId: "projectId" in extra ? extra.projectId : SHOP.id,
  });

describe("productSidebarBoards", () => {
  describe("given boards homed in several products", () => {
    /** @scenario "Each product's sidebar lists its own boards" */
    it("lists only the product's own, My dashboard first, then the rest by name", () => {
      const groups = groupsOf([
        board({ id: "zeta" }),
        board({ id: "alpha" }),
        board({ id: "llm", homeProduct: "llm-ops" }),
        board({ id: "mine", name: "My dashboard", createdById: ME }),
      ]);

      expect(groups.rows.map(({ id }) => id)).toEqual(["mine", "alpha", "zeta"]);
    });

    it("leaves out a board that opens nowhere", () => {
      expect(groupsOf([board({ id: "hidden", openProject: null })]).rows).toEqual([]);
    });
  });

  describe("given LLM Ops boards at every scope, with Shop in view", () => {
    /** @scenario "The LLM Ops section in a project lists the same boards, filtered" */
    it("lists Shop's Project boards, Organization and Only me boards, and no other project's", () => {
      const groups = groupsOf(
        [
          board({ id: "shop-project", homeProduct: "llm-ops", scope: "PROJECT" }),
          board({ id: "ops-project", homeProduct: "llm-ops", scope: "PROJECT", project: OPS }),
          board({ id: "ops-organization", homeProduct: "llm-ops", project: OPS }),
          board({ id: "only-me", homeProduct: "llm-ops", scope: "PRIVATE", project: OPS }),
        ],
        { product: "llm-ops" },
      );

      expect(groups.rows.map(({ id }) => id)).toEqual([
        "only-me",
        "ops-organization",
        "shop-project",
      ]);
    });
  });

  describe("given the From LangWatch boards", () => {
    it("lists them all in LLM Ops with a project in view, and nowhere else", () => {
      expect(groupsOf([], { product: "llm-ops" }).fromLangWatch).toEqual(CURATED_BOARDS);
      expect(groupsOf([], { product: "llm-ops", projectId: void 0 }).fromLangWatch).toEqual([]);
      expect(groupsOf([], { product: "gateway" }).fromLangWatch).toEqual([]);
    });
  });
});

describe("sharingTitle", () => {
  it.each([
    { scope: "PRIVATE", title: "Only you can see this" },
    { scope: "PROJECT", title: "Shared with Shop" },
    { scope: "ORGANIZATION", title: "Shared with the organization" },
  ] as const)("says who sees a $scope board", ({ scope, title }) => {
    expect(sharingTitle({ scope, project: SHOP })).toBe(title);
  });
});
