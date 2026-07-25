/**
 * AUDIT PROBE — not a shipped test. Executes the real classifier + guard to
 * observe that promoting a Lite Member onto a manage-capable custom role never
 * consults the full-seat cap.
 *
 * `organization.updateMemberRole` (src/server/api/routers/organization.ts:1450-1455)
 * computes the post-change member type with a hard-coded `undefined` for the NEW
 * permissions, even though `input.teamRoleUpdates[].customRoleId` (schema at
 * :1377-1386) already names the role being assigned, and the same value is
 * handed to the write at :1484. `isFullMember(EXTERNAL, undefined)` is always
 * false, so `getRoleChangeType` can never return "lite-to-full" on this path and
 * `assertMemberTypeLimitNotExceeded` (license-limit-guard.ts:38-40) returns
 * immediately on "no-change". The member is written with real write permissions
 * and is a Full Member from that moment on.
 */
import { OrganizationUserRole } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";

import {
  classifyMemberType,
  getRoleChangeType,
} from "../member-classification";
import { assertMemberTypeLimitNotExceeded } from "../license-limit-guard";
import type { ILicenseEnforcementRepository } from "../license-enforcement.repository";

const MANAGE_CAPABLE_CUSTOM_ROLE = ["project:update", "project:manage"];

const limitsAtCap = {
  maxMembers: 1,
  maxMembersLite: 100,
  overrideAddingLimitations: false,
};

describe("given an organization already at its full-member seat cap", () => {
  describe("when a Lite Member is promoted onto a manage-capable custom role", () => {
    it("skips the seat-cap check because the new permissions are never resolved", async () => {
      // What the router actually computes today.
      const changeTypeAsRouterComputesIt = getRoleChangeType(
        OrganizationUserRole.EXTERNAL,
        undefined, // no current custom role: a plain Lite Member
        OrganizationUserRole.EXTERNAL, // input.role stays EXTERNAL
        undefined, // organization.ts:1454 — hard-coded, never resolved
      );
      expect(changeTypeAsRouterComputesIt).toBe("no-change");

      // What it would compute if the new role's permissions were passed.
      const changeTypeWithTheRealNewRole = getRoleChangeType(
        OrganizationUserRole.EXTERNAL,
        undefined,
        OrganizationUserRole.EXTERNAL,
        MANAGE_CAPABLE_CUSTOM_ROLE,
      );
      expect(changeTypeWithTheRealNewRole).toBe("lite-to-full");

      // After the write, the member classifies as a Full Member — the seat the
      // cap exists to ration.
      expect(
        classifyMemberType(
          OrganizationUserRole.EXTERNAL,
          MANAGE_CAPABLE_CUSTOM_ROLE,
        ),
      ).toBe("FullMember");

      const getMemberCount = vi.fn().mockResolvedValue(1); // already at cap
      const repo = {
        getMemberCount,
        getMembersLiteCount: vi.fn().mockResolvedValue(0),
      } as unknown as ILicenseEnforcementRepository;

      // The guard as the router calls it: returns silently, never even counts.
      await expect(
        assertMemberTypeLimitNotExceeded(
          changeTypeAsRouterComputesIt,
          "org_acme",
          repo,
          limitsAtCap,
        ),
      ).resolves.toBeUndefined();
      expect(getMemberCount).not.toHaveBeenCalled();

      // The guard with the correct change type: FORBIDDEN, as intended.
      await expect(
        assertMemberTypeLimitNotExceeded(
          changeTypeWithTheRealNewRole,
          "org_acme",
          repo,
          limitsAtCap,
        ),
      ).rejects.toThrow();
      expect(getMemberCount).toHaveBeenCalledOnce();
    });
  });
});
