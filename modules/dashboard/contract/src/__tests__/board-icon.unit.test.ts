/** The board icon allow-list. Spec: dashboard-icons.feature. */
import { describe, expect, it } from "vitest";

import {
  boardSchema,
  DASHBOARD_ICONS,
  dashboardDetailsUpdateSchema,
  dashboardIconSchema,
  isDashboardIcon,
  storedDashboardIconSchema,
} from "../index.ts";

describe("the board icon allow-list", () => {
  describe("when it is read", () => {
    /** @scenario "The allow-list is one list of about 80 Lucide names" */
    it("holds 80 distinct kebab-case names", () => {
      expect(DASHBOARD_ICONS).toHaveLength(80);
      expect(new Set(DASHBOARD_ICONS).size).toBe(80);
      expect(DASHBOARD_ICONS.every((name) => /^[a-z0-9]+(-[a-z0-9]+)*$/.test(name))).toBe(true);
    });

    /** @scenario "The allow-list is one list of about 80 Lucide names" */
    it("accepts a listed name and refuses one that is not", () => {
      expect(dashboardIconSchema.validate("chart-line")).toBe(true);
      expect(dashboardIconSchema.validate("not-an-icon")).toBe(false);
      expect(dashboardIconSchema.validate("Chart-Line")).toBe(false);
      expect(isDashboardIcon("rocket")).toBe(true);
      expect(isDashboardIcon(null)).toBe(false);
    });

    /** @scenario "The allow-list is one list of about 80 Lucide names" */
    it("refuses an unknown icon in a board update, and lets null reset it", () => {
      expect(dashboardDetailsUpdateSchema.validate({ icon: "not-an-icon" })).toBe(false);
      expect(dashboardDetailsUpdateSchema.parse({ icon: null })).toEqual({ icon: null });
    });
  });

  describe("when a stored board names an icon this release does not know", () => {
    /** @scenario "A name this release does not know reads as no icon" */
    it("reads it as no icon rather than failing the board", () => {
      expect(storedDashboardIconSchema.parse("from-a-newer-release")).toBeNull();
      expect(storedDashboardIconSchema.parse(null)).toBeNull();
      expect(storedDashboardIconSchema.parse("rocket")).toBe("rocket");
      const board = boardSchema.parse({
        id: "board-1",
        projectId: "project-1",
        name: "Spend",
        order: 0,
        description: null,
        createdById: null,
        scope: "PROJECT",
        organizationId: null,
        createdAt: new Date(0),
        updatedAt: new Date(0),
        homeProduct: "llm-ops",
        icon: "from-a-newer-release",
      });
      expect(board.icon).toBeNull();
    });
  });
});
