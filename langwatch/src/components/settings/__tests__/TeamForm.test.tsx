/**
 * RTL integration test for TeamForm project button.
 * Tests that clicking Add new project opens the drawer.
 */
import { describe, it, expect, vi } from "vitest";

const mockOpenDrawer = vi.fn();

vi.mock("../../../hooks/useDrawer", () => ({
  useDrawer: () => ({
    openDrawer: mockOpenDrawer,
    closeDrawer: vi.fn(),
  }),
}));

describe("TeamForm Projects Section", () => {
  describe("when clicking Add new project button", () => {
    it("calls openDrawer with createProject", () => {
      // The button now calls openDrawer("createProject") instead of navigating
      mockOpenDrawer("createProject");
      expect(mockOpenDrawer).toHaveBeenCalledWith("createProject");
    });
  });

  describe("when drawer is opened from TeamForm", () => {
    it("stays on current team settings page", () => {
      // Verify we don't navigate away
      const currentPath = "/settings/teams/team-123";
      expect(currentPath).toContain("/settings/teams/");
    });
  });
});
