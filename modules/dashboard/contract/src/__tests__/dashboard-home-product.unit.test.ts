/** A board's home product rules. Spec: dashboards-organization-area.feature (Create, Move). */
import { describe, expect, it } from "vitest";

import {
  DASHBOARD_HOME_PRODUCTS,
  DASHBOARD_SCOPES,
  dashboardScopeAfterMove,
  homeAllowsScope,
  type DashboardScope,
} from "../index.ts";

const AUTHOR = { userId: "author" };
const TEAMMATE = { userId: "teammate" };
const OUTSIDE_LLM_OPS = DASHBOARD_HOME_PRODUCTS.filter((home) => home !== "llm-ops");

const board = (scope: DashboardScope) => ({ scope, createdById: AUTHOR.userId });

describe("a board's home product", () => {
  describe("when a scope is asked of a home", () => {
    /** @scenario "A board outside LLM Ops cannot be Project" */
    it("allows every scope in LLM Ops", () => {
      expect(
        DASHBOARD_SCOPES.map((scope) => homeAllowsScope({ homeProduct: "llm-ops", scope })),
      ).toEqual([true, true, true]);
    });

    /** @scenario "A board outside LLM Ops cannot be Project" */
    it("allows Only me and Organization, and never Project, in every other product", () => {
      for (const homeProduct of OUTSIDE_LLM_OPS) {
        expect(
          DASHBOARD_SCOPES.map((scope) => [scope, homeAllowsScope({ homeProduct, scope })]),
        ).toEqual([
          ["PRIVATE", true],
          ["PROJECT", false],
          ["ORGANIZATION", true],
        ]);
      }
    });
  });

  describe("when a board moves", () => {
    /** @scenario "Only the author can move a Project board out of LLM Ops" */
    it("makes its author's Project board Only me outside LLM Ops", () => {
      for (const homeProduct of OUTSIDE_LLM_OPS) {
        expect(
          dashboardScopeAfterMove({ board: board("PROJECT"), viewer: AUTHOR, homeProduct }),
        ).toBe("PRIVATE");
      }
    });

    /** @scenario "Only the author can move a Project board out of LLM Ops" */
    it("leaves anyone else's move of a Project board out of LLM Ops to its author", () => {
      const moved = (createdById: string | null) =>
        dashboardScopeAfterMove({
          board: { scope: "PROJECT", createdById },
          viewer: TEAMMATE,
          homeProduct: "gateway",
        });

      expect([moved(AUTHOR.userId), moved(null)]).toEqual(["author-only", "author-only"]);
    });

    /** @scenario "Moving a board changes its home only" */
    it("keeps every other scope, and a Project board within LLM Ops", () => {
      const after = (scope: DashboardScope, homeProduct: "llm-ops" | "governance") =>
        dashboardScopeAfterMove({ board: board(scope), viewer: TEAMMATE, homeProduct });

      expect([
        after("PRIVATE", "governance"),
        after("ORGANIZATION", "governance"),
        after("ORGANIZATION", "llm-ops"),
        after("PRIVATE", "llm-ops"),
        after("PROJECT", "llm-ops"),
      ]).toEqual(["PRIVATE", "ORGANIZATION", "ORGANIZATION", "PRIVATE", "PROJECT"]);
    });
  });
});
