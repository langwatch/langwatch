/**
 * A product sidebar's Dashboards section: which boards it lists, in which group and order.
 * @see modules/dashboard/specs/dashboards-organization-area.feature
 */

import { describe, expect, it } from "vitest";

import type { LibraryBoard } from "../model/organization-library.ts";
import {
  productDefaultBoard,
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

describe("a product's pinned From LangWatch board", () => {
  /** @scenario "Each product pins its own From LangWatch board first" */
  it.each([
    { product: "llm-ops", name: "My agent at a glance", href: "/shop/dashboards/curated/cockpit" },
    { product: "gateway", name: "Gateway costs", href: "/dashboards/curated/gateway-costs" },
    { product: "me", name: "Coding agent costs", href: "/dashboards/curated/coding-costs" },
  ] as const)("pins $name in $product, linked to its address", ({ product, name, href }) => {
    expect(productDefaultBoard({ product, projectSlug: "shop" })).toEqual({
      templateId: href.split("/").pop(),
      name,
      href,
    });
  });

  /** @scenario "Each product pins its own From LangWatch board first" */
  it("pins nothing in Governance, and no project board without a project in view", () => {
    expect(productDefaultBoard({ product: "governance", projectSlug: "shop" })).toBeUndefined();
    expect(productDefaultBoard({ product: "llm-ops", projectSlug: undefined })).toBeUndefined();
    expect(productDefaultBoard({ product: "gateway", projectSlug: undefined })?.href).toBe(
      "/dashboards/curated/gateway-costs",
    );
  });
});
