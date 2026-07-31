/**
 * "Invite teammate" is one of the command bar's action commands: it has no
 * path to navigate to, so the bar has to close itself and hand over to the
 * URL-routed invite drawer. Driven through the real registry entry so the
 * command and its handler cannot drift apart.
 *
 * @see specs/settings/add-member-drawer.feature
 */
import { describe, expect, it, vi } from "vitest";
import { allStaticCommands } from "../command-registry";
import { handleCommandSelect } from "../selectHandlers";

function inviteTeammateCommand() {
  const command = allStaticCommands.find(
    (candidate) => candidate.label === "Invite teammate",
  );
  if (!command) throw new Error("No 'Invite teammate' command in the registry");
  return command;
}

function harness() {
  const close = vi.fn();
  const push = vi.fn(async () => true);
  const openDrawer = vi.fn();
  const addRecentItem = vi.fn();
  return {
    close,
    push,
    openDrawer,
    addRecentItem,
    select: (command = inviteTeammateCommand()) =>
      handleCommandSelect(
        command,
        "my-project",
        { router: { push }, newTab: false, close },
        addRecentItem,
        openDrawer,
      ),
  };
}

describe("the command bar's 'Invite teammate' command", () => {
  describe("given the command bar is open", () => {
    describe("when the user runs the command", () => {
      /** @scenario The command bar opens the invite drawer */
      it("closes the bar and opens the invite-member drawer", () => {
        const { select, close, openDrawer, push } = harness();

        select();

        expect(close).toHaveBeenCalledOnce();
        expect(openDrawer).toHaveBeenCalledWith("inviteMember");
        // A drawer, not a page: nothing navigates away from where the user was.
        expect(push).not.toHaveBeenCalled();
      });

      it("does not file the drawer away as a recently visited page", () => {
        const { select, addRecentItem } = harness();

        select();

        expect(addRecentItem).not.toHaveBeenCalled();
      });
    });
  });

  describe("given the registry entry for inviting a teammate", () => {
    it("is an action with no path, so it can only resolve to a drawer", () => {
      const command = inviteTeammateCommand();

      expect(command.category).toBe("actions");
      expect(command.path).toBeUndefined();
    });
  });
});
