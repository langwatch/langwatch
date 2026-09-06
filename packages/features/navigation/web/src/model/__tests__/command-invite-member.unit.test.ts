/**
 * The command bar's own way into the invite flow: it closes itself and opens
 * the invite drawer, so inviting a teammate is reachable from anywhere.
 * @see specs/settings/add-member-drawer.feature
 */
import { describe, expect, it, vi } from "vitest";
import { allStaticCommands } from "../command-catalogue";
import { handleCommandSelect } from "../command-select-handlers";

describe("the command bar's invite command", () => {
  describe("given the bar is open", () => {
    /** @scenario The command bar opens the invite drawer */
    it("closes the bar and opens the invite drawer", () => {
      const command = allStaticCommands.find((entry) => entry.id === "action-invite-member");
      expect(command).toBeDefined();

      const close = vi.fn();
      const openDrawer = vi.fn();

      handleCommandSelect(
        command!,
        "project-1",
        { go: vi.fn(), newTab: false, close },
        vi.fn(),
        openDrawer,
      );

      expect(close).toHaveBeenCalled();
      expect(openDrawer).toHaveBeenCalledWith("inviteMember");
    });
  });
});
