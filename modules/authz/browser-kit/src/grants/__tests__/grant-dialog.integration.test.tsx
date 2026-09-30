/** @vitest-environment jsdom */
// The grant dialog collects a grant or a role change and hands it back; it fetches nothing.
// Spec: specs/rbac/roles-and-access-ui.feature

import { fireEvent, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { GrantDialog, type GrantDialogProps } from "../grant-dialog.tsx";
import { expiryFromDay } from "../grants.ts";
import { grantRow, renderInChakra } from "./grant-fixtures.tsx";

function renderDialog(over: Partial<GrantDialogProps> = {}) {
  const props: GrantDialogProps = {
    organizationId: "org-1",
    editing: null,
    roles: [],
    members: [{ id: "u-sam", name: "Sam", email: "sam@acme.com" }],
    groups: [{ id: "g-eng", name: "Engineering" }],
    structure: { organizationName: "Acme", teams: [], projects: [] },
    heldPermissions: ["organization:manage", "project:view"],
    isSaving: false,
    onScopeChange: vi.fn(),
    onCreate: vi.fn(),
    onChangeRole: vi.fn(),
    onClose: vi.fn(),
    ...over,
  };
  renderInChakra(<GrantDialog {...props} />);

  return props;
}

describe("GrantDialog", () => {
  describe("when the reader grants a role", () => {
    it("hands back one grant for the member, role and organization, ending on the day picked", async () => {
      const props = renderDialog();

      const dialog = await screen.findByRole("dialog");
      fireEvent.change(within(dialog).getByLabelText("Who"), { target: { value: "user:u-sam" } });
      fireEvent.change(within(dialog).getByLabelText("Role"), { target: { value: "viewer" } });
      fireEvent.change(within(dialog).getByLabelText("Ends on"), {
        target: { value: "2026-12-31" },
      });
      fireEvent.click(within(dialog).getByTestId("grant-submit"));

      expect(props.onCreate).toHaveBeenCalledWith({
        principal: { type: "user", id: "u-sam" },
        roleId: "viewer",
        scope: { type: "organization", id: "org-1" },
        expiresAt: expiryFromDay("2026-12-31"),
      });
    });

    /** @scenario A role beyond the reader's own access is greyed out */
    it("offers a custom role the reader lacks a permission of, but not to pick", async () => {
      renderDialog({
        roles: [
          { id: "role_wide", name: "Wide", permissions: ["project:view", "project:delete"] },
          { id: "role_narrow", name: "Narrow", permissions: ["project:view"] },
        ],
      });

      const dialog = await screen.findByRole("dialog");

      expect(
        within(dialog).getByRole("option", { name: "Wide (more access than you have)" }),
      ).toBeDisabled();
      expect(within(dialog).getByRole("option", { name: "Narrow" })).toBeEnabled();
      expect(within(dialog).getByRole("option", { name: "Admin" })).toBeEnabled();
    });

    it("greys out nothing until the reader's standing is known", async () => {
      renderDialog({
        heldPermissions: undefined,
        roles: [{ id: "role_wide", name: "Wide", permissions: ["project:delete"] }],
      });

      const dialog = await screen.findByRole("dialog");

      expect(within(dialog).getByRole("option", { name: "Wide" })).toBeEnabled();
    });
  });

  describe("when the reader changes the role of a grant", () => {
    it("hands back only the role of the grant being edited", async () => {
      const props = renderDialog({ editing: grantRow({}) });

      const dialog = await screen.findByRole("dialog");
      expect(within(dialog).getByText("Sam on Team · Platform")).toBeInTheDocument();
      expect(within(dialog).queryByLabelText("Who")).not.toBeInTheDocument();
      fireEvent.change(within(dialog).getByLabelText("Role"), { target: { value: "member" } });
      fireEvent.click(within(dialog).getByTestId("grant-submit"));

      expect(props.onChangeRole).toHaveBeenCalledWith({ grantId: "gr-1", roleId: "member" });
      expect(props.onCreate).not.toHaveBeenCalled();
    });
  });
});
