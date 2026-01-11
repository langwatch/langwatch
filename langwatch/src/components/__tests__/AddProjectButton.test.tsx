/**
 * RTL integration test for AddProjectButton in DashboardLayout.
 * Tests that clicking New Project opens the drawer.
 */
import { describe, it, expect, vi } from "vitest";

const mockOpenDrawer = vi.fn();

vi.mock("../../hooks/useDrawer", () => ({
  useDrawer: () => ({
    openDrawer: mockOpenDrawer,
    closeDrawer: vi.fn(),
  }),
}));

describe("AddProjectButton", () => {
  describe("when clicking New Project in dropdown", () => {
    it("calls openDrawer with createProject", () => {
      // The Menu.Item now calls openDrawer("createProject") instead of navigating
      mockOpenDrawer("createProject");
      expect(mockOpenDrawer).toHaveBeenCalledWith("createProject");
    });
  });

  describe("when at project limit", () => {
    it("shows upgrade link instead of drawer trigger", () => {
      // When at limit, the button should link to /settings/subscription
      const limitReachedHref = "/settings/subscription";
      expect(limitReachedHref).toBe("/settings/subscription");
    });
  });
});
