/**
 * A product sidebar's Dashboards section: which boards it lists, in which group and order.
 * @see modules/dashboard/specs/dashboards-organization-area.feature
 */

import { describe, expect, it } from "vitest";

import { CURATED_BOARDS } from "../model/curated-boards.ts";
import type { LibraryBoard } from "../model/organization-library.ts";
import {
  boardsHomedOutside,
  hasProductBoards,
  productSidebarBoards,
  sharingTitle,
} from "../model/product-dashboards.ts";

const SHOP = { id: "proj-shop", slug: "shop", name: "Shop" };
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
  starPosition: null,
  ...overrides,
});

const groupsOf = (
  boards: readonly LibraryBoard[],
  extra: { product?: LibraryBoard["homeProduct"]; templateIds?: string[] } = {},
) =>
  productSidebarBoards({
    boards,
    product: extra.product ?? "gateway",
    userId: ME,
    curated: CURATED_BOARDS,
    starredTemplateIds: extra.templateIds ?? [],
    hasProject: true,
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

    it("puts the product's starred boards in their own group, in star order", () => {
      const groups = groupsOf([
        board({ id: "late", starPosition: 4 }),
        board({ id: "plain" }),
        board({ id: "early", starPosition: 1 }),
      ]);

      expect(groups.rows.map(({ id }) => id)).toEqual(["plain"]);
      expect(groups.starred.map(({ id }) => id)).toEqual(["early", "late"]);
    });

    it("leaves out a board that opens nowhere", () => {
      expect(groupsOf([board({ id: "hidden", openProject: null })]).rows).toEqual([]);
    });
  });

  describe("given the From LangWatch boards", () => {
    it("lists them only in LLM Ops, a starred one in the starred group", () => {
      const [first, ...rest] = CURATED_BOARDS;
      const llmOps = groupsOf([], { product: "llm-ops", templateIds: [first?.templateId ?? ""] });

      expect(llmOps.starredCurated).toEqual([first]);
      expect(llmOps.fromLangWatch).toEqual(rest);
      expect(groupsOf([], { product: "gateway" }).fromLangWatch).toEqual([]);
    });
  });

  describe("given nothing homed in the product and no From LangWatch board", () => {
    /** @scenario "Each product's sidebar lists its own boards" */
    it("has nothing to list, so the section hides", () => {
      expect(hasProductBoards(groupsOf([board({ id: "llm", homeProduct: "llm-ops" })]))).toBe(
        false,
      );
    });
  });
});

describe("boardsHomedOutside", () => {
  /** @scenario "Every sidebar lists my stars from other products" */
  it("leaves out the sidebar's own product, and keeps every board in the library", () => {
    const boards = [board({ id: "gw" }), board({ id: "llm", homeProduct: "llm-ops" })];

    expect(boardsHomedOutside({ boards, product: "gateway" }).map(({ id }) => id)).toEqual([
      "llm",
    ]);
    expect(boardsHomedOutside({ boards, product: void 0 })).toHaveLength(2);
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
