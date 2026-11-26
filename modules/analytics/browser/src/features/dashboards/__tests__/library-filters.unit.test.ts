/**
 * The library's search, filters and column sort, as pure rules over its rows.
 * @see modules/dashboard/specs/dashboards-organization-area.feature
 */

import { describe, expect, it } from "vitest";

import {
  filterLibraryBoards,
  hasLibraryFilters,
  type LibraryFilters,
  libraryProductChips,
  librarySummary,
  nextLibrarySort,
  NO_LIBRARY_FILTERS,
  sortLibraryBoards,
} from "../model/library-filters.ts";
import { type LibraryBoard, libraryRows } from "../model/organization-library.ts";

const SHOP = { id: "proj-shop", slug: "shop", name: "Shop" };
const REFUNDS = { id: "proj-refunds", slug: "refunds", name: "Refunds desk" };
const ME = "user-me";

const board = (overrides: Partial<LibraryBoard> & Pick<LibraryBoard, "id">): LibraryBoard => ({
  name: overrides.id,
  description: null,
  createdById: "someone",
  ownerName: "Ada",
  scope: "ORGANIZATION",
  homeProduct: "llm-ops",
  project: SHOP,
  openProject: SHOP,
  updatedAt: "2026-11-20T10:00:00.000Z",
  ...overrides,
});

const ids = (boards: readonly LibraryBoard[]) => boards.map(({ id }) => id);
const filtered = (boards: readonly LibraryBoard[], change: Partial<LibraryFilters>) =>
  ids(filterLibraryBoards({ boards, filters: { ...NO_LIBRARY_FILTERS, ...change }, userId: ME }));

describe("filterLibraryBoards", () => {
  describe("given boards with refunds in a name, a description, a project and an owner", () => {
    const boards = [
      board({ id: "by-name", name: "Refund rate" }),
      board({ id: "latency", name: "Latency" }),
      board({ id: "by-description", name: "Weekly", description: "Weekly refunds review" }),
      board({ id: "by-project", name: "Costs", project: REFUNDS }),
      board({ id: "by-owner", name: "Tokens", ownerName: "Refund Team" }),
    ];

    /** @scenario "The library's search finds a board by its name, description, project or owner" */
    it("lists only the boards that hold the search text, whatever the case", () => {
      expect(filtered(boards, { search: "  REFUND " })).toEqual([
        "by-name",
        "by-description",
        "by-project",
        "by-owner",
      ]);
      expect(librarySummary({ shown: 2, total: 5 })).toBe("2 of 5 dashboards");
    });
  });

  describe("given boards in several products, mine and another member's, at each scope", () => {
    const boards = [
      board({ id: "gw-mine-org", homeProduct: "gateway", createdById: ME }),
      board({ id: "gw-mine-private", homeProduct: "gateway", createdById: ME, scope: "PRIVATE" }),
      board({ id: "gw-theirs-org", homeProduct: "gateway" }),
      board({ id: "ops-mine-org", homeProduct: "llm-ops", createdById: ME }),
      board({ id: "ops-theirs-project", homeProduct: "llm-ops", scope: "PROJECT" }),
    ];

    /** @scenario "The library's filters narrow it by product, owner and who sees it" */
    it("narrows by product, owner and scope together, and with the search", () => {
      const picked = { product: "gateway", owner: "me", sharing: "ORGANIZATION" } as const;

      expect(filtered(boards, picked)).toEqual(["gw-mine-org"]);
      expect(filtered(boards, { ...picked, search: "nothing" })).toEqual([]);
      expect(hasLibraryFilters({ ...NO_LIBRARY_FILTERS, owner: "me" })).toBe(true);
      expect(hasLibraryFilters(NO_LIBRARY_FILTERS)).toBe(false);
    });

    it("offers All and each product with a board, each counting under the other filters", () => {
      const chips = libraryProductChips({
        boards,
        filters: { ...NO_LIBRARY_FILTERS, owner: "me" },
        userId: ME,
      });

      expect(chips).toEqual([
        { value: "all", label: "All", count: 3 },
        { value: "llm-ops", label: "LLM Ops", count: 1 },
        { value: "gateway", label: "Gateway", count: 2 },
      ]);
    });
  });
});

describe("sortLibraryBoards", () => {
  const boards = libraryRows({
    boards: [
      board({ id: "beta", name: "Beta", updatedAt: "2026-11-01T00:00:00.000Z" }),
      board({ id: "alpha", name: "Alpha", updatedAt: "2026-11-25T00:00:00.000Z" }),
      board({
        id: "coding",
        name: "Zeta",
        homeProduct: "me",
        updatedAt: "2026-10-01T00:00:00.000Z",
      }),
    ],
  });

  /** @scenario "The library sorts by name or by last change" */
  it("sorts by name A to Z then Z to A, by updated newest first then oldest first", () => {
    const name = nextLibrarySort({ sort: void 0, column: "name" });
    const updated = nextLibrarySort({ sort: name, column: "updated" });

    expect(ids(sortLibraryBoards({ boards, sort: void 0 }))).toEqual(["coding", "alpha", "beta"]);
    expect(ids(sortLibraryBoards({ boards, sort: name }))).toEqual(["alpha", "beta", "coding"]);
    expect(
      ids(sortLibraryBoards({ boards, sort: nextLibrarySort({ sort: name, column: "name" }) })),
    ).toEqual(["coding", "beta", "alpha"]);
    expect(ids(sortLibraryBoards({ boards, sort: updated }))).toEqual(["alpha", "beta", "coding"]);
    expect(
      ids(
        sortLibraryBoards({ boards, sort: nextLibrarySort({ sort: updated, column: "updated" }) }),
      ),
    ).toEqual(["coding", "beta", "alpha"]);
  });
});
