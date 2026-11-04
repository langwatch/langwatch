// The CLI approval screen's permission list: Customize must never widen the key past what
// a CLI login key may carry. Opening Customize and saving with no change once raised
// Organization to "Write", whose expansion includes organization:delete.
// Spec: specs/ai-governance/cli-onboarding/login-user-scoped-key.feature

import {
  cliPermissionCategories,
  defaultCliKeyPermissions,
  isOffByDefaultOnCliKey,
  selectionsFromPermissions,
} from "@langwatch/api-key-contract";
import { builtinRolePermissions } from "@langwatch/authz-contract";
import { describe, expect, it } from "vitest";

import {
  categoryAccessAvailability,
  clampSelectionsToAvailability,
} from "../api-key-permissions.ts";
import { cliKeyPermissions, cliSelectionsFromPermissions } from "../cli-key-permissions.ts";

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

      /** @scenario "on the approval screen, Organization at Write means managing it, not deleting it" */
      it("keeps every default permission held and adds none left off by default", () => {
        const defaultPermissionsHeld: string[] = adminHeld(management);

        const permissions = cliKeyPermissions({
          isCustomized: true,
          selections: cliSelectionsFromPermissions(defaultPermissionsHeld),
          defaultPermissionsHeld,
        });

        // Write spells out what each held `X:manage` already implies, so the list may
        // grow, but never by a permission the default deliberately leaves out.
        expect(defaultPermissionsHeld.filter((p) => !permissions.includes(p))).toEqual([]);
        expect(
          permissions.filter(
            (p) => isOffByDefaultOnCliKey(p) && !defaultPermissionsHeld.includes(p),
          ),
        ).toEqual([]);
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

  describe("when Customize opens on a --management login", () => {
    /** @scenario "on the approval screen, Organization at Write means managing it, not deleting it" */
    it("shows Organization at Write", () => {
      expect(cliSelectionsFromPermissions(adminHeld(true)).organization).toBe("write");
    });
  });
});

describe("given a caller who manages the organization but may not delete it", () => {
  const managerOnly = [...builtinRolePermissions("org-admin")].filter(
    (permission) => permission !== "organization:delete",
  );
  const organization = cliPermissionCategories().find((c) => c.key === "organization")!;

  describe("when the CLI approval screen offers the Organization row", () => {
    /** @scenario "on the approval screen, Organization at Write means managing it, not deleting it" */
    it("offers Write, which a CLI key reads without organization:delete", () => {
      expect(organization.writePermissions).not.toContain("organization:delete");
      expect(
        categoryAccessAvailability({ category: organization, userPermissions: managerOnly })
          .canWrite,
      ).toBe(true);
    });
  });

  describe("when a selection of Organization at Write is clamped to that ceiling", () => {
    /** @scenario "on the approval screen, Organization at Write means managing it, not deleting it" */
    it("stays at Write", () => {
      expect(
        clampSelectionsToAvailability({
          selections: { organization: "write" },
          userPermissions: managerOnly,
          categories: cliPermissionCategories(),
        }),
      ).toEqual({ organization: "write" });
    });
  });
});

describe("given the regular API key categories", () => {
  describe("when a caller manages the organization but may not delete it", () => {
    /** @scenario "on the approval screen, Organization at Write means managing it, not deleting it" */
    it("still withholds Organization at Write, whose expansion includes organization:delete", () => {
      const managerOnly = [...builtinRolePermissions("org-admin")].filter(
        (permission) => permission !== "organization:delete",
      );

      expect(
        clampSelectionsToAvailability({
          selections: { organization: "write" },
          userPermissions: managerOnly,
        }),
      ).toEqual({ organization: "read" });
    });
  });
});
