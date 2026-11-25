/**
 * The command bar's own way into the invite flow: it closes itself and opens
 * the invite drawer, so inviting a teammate is reachable from anywhere.
 * @see specs/settings/add-member-drawer.feature
 */
import { InviteMemberDrawerToken } from "@langwatch/organization-client";
import { describe, expect, it, vi } from "vitest";

import { allStaticCommands } from "../model/command-catalogue.ts";
import { handleCommandSelect } from "../model/command-select-handlers.ts";

describe("the command bar's invite command", () => {
  describe("given the bar is open", () => {
    /** @scenario The command bar opens the invite drawer */
    it("closes the bar and opens the invite drawer", () => {
      const command = allStaticCommands.find((entry) => entry.id === "action-invite-member");
      expect(command).toBeDefined();

      const close = vi.fn();
      const openDrawer = vi.fn();
      const openDrawerByToken = vi.fn();

      handleCommandSelect({
        cmd: command!,
        projectSlug: "project-1",
        ctx: { go: vi.fn(), newTab: false, close },
        addRecentItem: vi.fn(),
        openDrawer,
        openDrawerByToken,
      });

      expect(close).toHaveBeenCalled();
      expect(openDrawerByToken).toHaveBeenCalledWith(InviteMemberDrawerToken);
    });
  });
});
