// The CLI approval screen's permission list: Customize must never widen the key past what
// a CLI login key may carry. Opening Customize and saving with no change once raised
// Organization to "Write", whose expansion includes organization:delete.
// Spec: specs/ai-governance/cli-onboarding/login-user-scoped-key.feature

import { defaultCliKeyPermissions, selectionsFromPermissions } from "@langwatch/api-key-contract";
import { builtinRolePermissions } from "@langwatch/authz-contract";
import { describe, expect, it } from "vitest";

import { cliKeyPermissions } from "../cli-key-permissions.ts";

// An organization admin's ceiling: the org bag plus the team admin bag it inherits.
const adminHeld = (management: boolean) => {
  const held = new Set<string>([
    ...builtinRolePermissions("org-admin"),
    ...builtinRolePermissions("admin"),
  ]);
  return defaultCliKeyPermissions({ management }).filter((permission) => held.has(permission));
};

describe("given an organization admin approving a CLI login", () => {
  describe.each([false, true])("when --management is %s", (management) => {
    describe("when the approver opens Customize and changes nothing", () => {
      /** @scenario "a CLI login key never carries organization:delete" */
      it("never adds organization:delete", () => {
        const defaultPermissionsHeld = adminHeld(management);

        const permissions = cliKeyPermissions({
          isCustomized: true,
          selections: selectionsFromPermissions(defaultPermissionsHeld),
          defaultPermissionsHeld,
        });

        expect(permissions).not.toContain("organization:delete");
      });
    });

    describe("when the approver sets Organization to Write", () => {
      /** @scenario "a CLI login key never carries organization:delete" */
      it("keeps organization:manage and leaves out organization:delete", () => {
        const permissions = cliKeyPermissions({
          isCustomized: true,
          selections: { organization: "write" },
          defaultPermissionsHeld: adminHeld(management),
        });

        expect(permissions).toContain("organization:manage");
        expect(permissions).not.toContain("organization:delete");
      });
    });

    describe("when the approver leaves Customize closed", () => {
      it("answers the default permissions held, unchanged", () => {
        const defaultPermissionsHeld = adminHeld(management);

        expect(
          cliKeyPermissions({ isCustomized: false, selections: {}, defaultPermissionsHeld }),
        ).toEqual(defaultPermissionsHeld);
      });
    });
  });
});
