/**
 * @vitest-environment node
 */
import type { Board } from "@langwatch/dashboard-contract";
import { describe, expect, it } from "vitest";

import { starredBoardRow } from "../starred-board-row.rules.ts";

const BOARD: Board = {
  id: "dashboard_1",
  projectId: "proj-1",
  name: "Spend",
  order: 0,
  description: null,
  createdById: "user-1",
  scope: "PROJECT",
  organizationId: null,
  createdAt: new Date("2026-01-01"),
  updatedAt: new Date("2026-01-01"),
  homeProduct: "llm-ops",
  icon: "dollar-sign",
};

describe("starredBoardRow()", () => {
  describe("given a board with an icon", () => {
    /** @scenario "The starred list shows the board's icon" */
    it("keeps the icon and drops the home product", () => {
      const row = starredBoardRow({ board: BOARD });
      expect(row.icon).toBe("dollar-sign");
      expect(row).not.toHaveProperty("homeProduct");
    });
  });

  describe("given a board with no icon", () => {
    /** @scenario "The starred list shows the board's icon" */
    it("carries a null icon", () => {
      expect(starredBoardRow({ board: { ...BOARD, icon: null } }).icon).toBeNull();
    });
  });
});
