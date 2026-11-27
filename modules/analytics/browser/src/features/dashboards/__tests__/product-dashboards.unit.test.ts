/**
 * A product sidebar's Dashboards section: which boards it lists, in which group and order.
 * @see modules/dashboard/specs/dashboards-organization-area.feature
 */

import { describe, expect, it } from "vitest";

import type { LibraryBoard } from "../model/organization-library.ts";
import {
  nextSidebarOrder,
  productSidebarBoards,
  sharingTitle,
} from "../model/product-dashboards.ts";

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
  updatedAt: "2026-11-20T10:00:00.000Z",
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

      expect(groups.map(({ id }) => id)).toEqual(["mine", "alpha", "zeta"]);
    });

    it("leaves out a board that opens nowhere", () => {
      expect(groupsOf([board({ id: "hidden", openProject: null })])).toEqual([]);
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

      expect(groups.map(({ id }) => id)).toEqual(["only-me", "ops-organization", "shop-project"]);
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

describe("given the member's own order of a section", () => {
  const llmOps = (overrides: Partial<LibraryBoard> & Pick<LibraryBoard, "id">) =>
    board({ homeProduct: "llm-ops", ...overrides });
  const listed = (boards: readonly LibraryBoard[], order: readonly string[]) =>
    productSidebarBoards({ boards, product: "llm-ops", userId: ME, projectId: SHOP.id, order }).map(
      ({ id }) => id,
    );
  const sectionBoards = [
    llmOps({ id: "mine", name: "My dashboard", createdById: ME }),
    llmOps({ id: "alpha", name: "Alpha" }),
    llmOps({ id: "beta", name: "Beta" }),
    llmOps({ id: "gamma", name: "Gamma" }),
  ];

  /** @scenario "Drag a board to reorder a product's Dashboards section" */
  it("lists the boards in the saved order with My dashboard kept first", () => {
    const order = nextSidebarOrder({ stored: [], shown: ["gamma", "alpha", "beta"] });

    expect(listed(sectionBoards, order)).toEqual(["mine", "gamma", "alpha", "beta"]);
    expect(listed(sectionBoards, ["gamma", "mine"])[0]).toBe("mine");
  });

  /** @scenario "A board my order does not name is listed after the ones it does, by name" */
  it("lists a board the order does not name after the named ones, by name, and skips gone ids", () => {
    const boards = [...sectionBoards, llmOps({ id: "aardvark", name: "Aardvark" })];

    expect(listed(boards, ["gone", "beta", "alpha"])).toEqual([
      "mine",
      "beta",
      "alpha",
      "aardvark",
      "gamma",
    ]);
  });
});

describe("nextSidebarOrder", () => {
  /** @scenario "Reordering in one project keeps the place of boards listed only in another" */
  it("keeps the slot of a board the project in view does not show", () => {
    const stored = ["org-a", "ops-project", "org-b"];

    expect(nextSidebarOrder({ stored, shown: ["org-b", "org-a"] })).toEqual([
      "org-b",
      "ops-project",
      "org-a",
    ]);
  });

  it("appends shown boards the stored order never named", () => {
    expect(nextSidebarOrder({ stored: ["a"], shown: ["c", "a", "b"] })).toEqual(["c", "a", "b"]);
  });
});
