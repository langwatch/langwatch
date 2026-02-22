import { describe, expect, it } from "vitest";
import { OrganizationUserRole } from "@prisma/client";
import {
  isViewOnlyPermission,
  isViewOnlyCustomRole,
  classifyMemberType,
  isFullMember,
  isLiteMember,
  getRoleChangeType,
} from "../member-classification";

/**
 * Unit tests for member classification functions.
 *
 * These pure functions determine member types based on roles and permissions:
 * - isViewOnlyPermission: checks if a single permission is view-only
 * - isViewOnlyCustomRole: checks if all permissions in a role are view-only
 * - classifyMemberType: classifies as FullMember or LiteMember (Lite Member)
 * - isFullMember/isLiteMember: convenience predicates
 *
 * Note: The EXTERNAL enum value corresponds to "Lite Member" in user-facing terminology.
 */

describe("isViewOnlyPermission", () => {
  it("returns true for view permission", () => {
    expect(isViewOnlyPermission("project:view")).toBe(true);
    expect(isViewOnlyPermission("analytics:view")).toBe(true);
    expect(isViewOnlyPermission("traces:view")).toBe(true);
  });

  it("returns false for manage permission", () => {
    expect(isViewOnlyPermission("project:manage")).toBe(false);
    expect(isViewOnlyPermission("analytics:manage")).toBe(false);
  });

  it("returns false for create permission", () => {
    expect(isViewOnlyPermission("project:create")).toBe(false);
  });

  it("returns false for update permission", () => {
    expect(isViewOnlyPermission("project:update")).toBe(false);
  });

  it("returns false for delete permission", () => {
    expect(isViewOnlyPermission("project:delete")).toBe(false);
  });

  it("returns false for share permission", () => {
    expect(isViewOnlyPermission("traces:share")).toBe(false);
  });

  it("handles edge cases with malformed permissions", () => {
    expect(isViewOnlyPermission("view")).toBe(false); // No colon
    expect(isViewOnlyPermission("")).toBe(false); // Empty string
    expect(isViewOnlyPermission("project:")).toBe(false); // Missing action
  });
});

describe("isViewOnlyCustomRole", () => {
  it("returns true when all permissions are view-only", () => {
    expect(
      isViewOnlyCustomRole(["project:view", "analytics:view", "traces:view"])
    ).toBe(true);
  });

  it("returns true for single view-only permission", () => {
    expect(isViewOnlyCustomRole(["project:view"])).toBe(true);
  });

  it("returns false when any permission is manage", () => {
    expect(isViewOnlyCustomRole(["project:view", "project:manage"])).toBe(
      false
    );
  });

  it("returns false when any permission is create", () => {
    expect(isViewOnlyCustomRole(["project:view", "project:create"])).toBe(
      false
    );
  });

  it("returns false when any permission is update", () => {
    expect(isViewOnlyCustomRole(["project:view", "project:update"])).toBe(
      false
    );
  });

  it("returns false when any permission is delete", () => {
    expect(isViewOnlyCustomRole(["project:view", "project:delete"])).toBe(
      false
    );
  });

  it("returns false when any permission is share", () => {
    expect(isViewOnlyCustomRole(["traces:view", "traces:share"])).toBe(false);
  });

  it("returns true for empty permissions array", () => {
    expect(isViewOnlyCustomRole([])).toBe(true);
  });
});

describe("classifyMemberType", () => {
  describe("role-based classification", () => {
    it("returns FullMember for ADMIN role", () => {
      expect(classifyMemberType(OrganizationUserRole.ADMIN, undefined)).toBe(
        "FullMember"
      );
    });

    it("returns FullMember for ADMIN role even with view-only permissions", () => {
      expect(
        classifyMemberType(OrganizationUserRole.ADMIN, ["project:view"])
      ).toBe("FullMember");
    });

    it("returns FullMember for MEMBER role", () => {
      expect(classifyMemberType(OrganizationUserRole.MEMBER, undefined)).toBe(
        "FullMember"
      );
    });

    it("returns FullMember for MEMBER role even with view-only permissions", () => {
      expect(
        classifyMemberType(OrganizationUserRole.MEMBER, ["project:view"])
      ).toBe("FullMember");
    });

    it("returns LiteMember for EXTERNAL role with no permissions (Lite Member)", () => {
      expect(classifyMemberType(OrganizationUserRole.EXTERNAL, undefined)).toBe(
        "LiteMember"
      );
    });
  });

  describe("EXTERNAL role (Lite Member) with custom permissions", () => {
    it("returns LiteMember for view-only permissions", () => {
      expect(
        classifyMemberType(OrganizationUserRole.EXTERNAL, ["project:view"])
      ).toBe("LiteMember");
    });

    it("returns LiteMember for multiple view-only permissions", () => {
      expect(
        classifyMemberType(OrganizationUserRole.EXTERNAL, [
          "project:view",
          "analytics:view",
          "traces:view",
        ])
      ).toBe("LiteMember");
    });

    it("returns FullMember for manage permission", () => {
      expect(
        classifyMemberType(OrganizationUserRole.EXTERNAL, [
          "project:view",
          "project:manage",
        ])
      ).toBe("FullMember");
    });

    it("returns FullMember for create permission", () => {
      expect(
        classifyMemberType(OrganizationUserRole.EXTERNAL, [
          "project:view",
          "project:create",
        ])
      ).toBe("FullMember");
    });

    it("returns FullMember for update permission", () => {
      expect(
        classifyMemberType(OrganizationUserRole.EXTERNAL, [
          "project:view",
          "project:update",
        ])
      ).toBe("FullMember");
    });

    it("returns FullMember for delete permission", () => {
      expect(
        classifyMemberType(OrganizationUserRole.EXTERNAL, [
          "project:view",
          "project:delete",
        ])
      ).toBe("FullMember");
    });

    it("returns FullMember for share permission", () => {
      expect(
        classifyMemberType(OrganizationUserRole.EXTERNAL, [
          "traces:view",
          "traces:share",
        ])
      ).toBe("FullMember");
    });

    it("returns LiteMember for empty permissions array", () => {
      expect(classifyMemberType(OrganizationUserRole.EXTERNAL, [])).toBe(
        "LiteMember"
      );
    });
  });
});

describe("isFullMember", () => {
  it("returns true for ADMIN role", () => {
    expect(isFullMember(OrganizationUserRole.ADMIN, undefined)).toBe(true);
  });

  it("returns true for MEMBER role", () => {
    expect(isFullMember(OrganizationUserRole.MEMBER, undefined)).toBe(true);
  });

  it("returns true for EXTERNAL with non-view permissions", () => {
    expect(
      isFullMember(OrganizationUserRole.EXTERNAL, [
        "project:view",
        "project:manage",
      ])
    ).toBe(true);
  });

  it("returns false for EXTERNAL with view-only permissions", () => {
    expect(
      isFullMember(OrganizationUserRole.EXTERNAL, ["project:view"])
    ).toBe(false);
  });

  it("returns false for EXTERNAL with no permissions", () => {
    expect(isFullMember(OrganizationUserRole.EXTERNAL, undefined)).toBe(false);
  });
});

describe("isLiteMember", () => {
  it("returns false for ADMIN role", () => {
    expect(isLiteMember(OrganizationUserRole.ADMIN, undefined)).toBe(false);
  });

  it("returns false for MEMBER role", () => {
    expect(isLiteMember(OrganizationUserRole.MEMBER, undefined)).toBe(false);
  });

  it("returns false for EXTERNAL with non-view permissions", () => {
    expect(
      isLiteMember(OrganizationUserRole.EXTERNAL, [
        "project:view",
        "project:manage",
      ])
    ).toBe(false);
  });

  it("returns true for EXTERNAL with view-only permissions", () => {
    expect(
      isLiteMember(OrganizationUserRole.EXTERNAL, ["project:view"])
    ).toBe(true);
  });

  it("returns true for EXTERNAL with no permissions", () => {
    expect(isLiteMember(OrganizationUserRole.EXTERNAL, undefined)).toBe(true);
  });

  it("returns true for EXTERNAL with empty permissions array", () => {
    expect(isLiteMember(OrganizationUserRole.EXTERNAL, [])).toBe(true);
  });
});

describe("getRoleChangeType", () => {
  describe("no-change scenarios", () => {
    it("returns no-change when both roles are Full Member (ADMIN to MEMBER)", () => {
      expect(
        getRoleChangeType(
          OrganizationUserRole.ADMIN,
          undefined,
          OrganizationUserRole.MEMBER,
          undefined
        )
      ).toBe("no-change");
    });

    it("returns no-change when both roles are Full Member (MEMBER to ADMIN)", () => {
      expect(
        getRoleChangeType(
          OrganizationUserRole.MEMBER,
          undefined,
          OrganizationUserRole.ADMIN,
          undefined
        )
      ).toBe("no-change");
    });

    it("returns no-change when both roles are Lite Member (EXTERNAL to EXTERNAL)", () => {
      expect(
        getRoleChangeType(
          OrganizationUserRole.EXTERNAL,
          undefined,
          OrganizationUserRole.EXTERNAL,
          ["project:view"]
        )
      ).toBe("no-change");
    });

    it("returns no-change when EXTERNAL with non-view to MEMBER (both Full Member)", () => {
      expect(
        getRoleChangeType(
          OrganizationUserRole.EXTERNAL,
          ["project:manage"],
          OrganizationUserRole.MEMBER,
          undefined
        )
      ).toBe("no-change");
    });

    it("returns no-change when custom role changes but stays view-only", () => {
      expect(
        getRoleChangeType(
          OrganizationUserRole.EXTERNAL,
          ["project:view"],
          OrganizationUserRole.EXTERNAL,
          ["project:view", "analytics:view"]
        )
      ).toBe("no-change");
    });

    it("returns no-change when custom role changes but stays non-view", () => {
      expect(
        getRoleChangeType(
          OrganizationUserRole.EXTERNAL,
          ["project:manage"],
          OrganizationUserRole.EXTERNAL,
          ["project:update"]
        )
      ).toBe("no-change");
    });
  });

  describe("lite-to-full scenarios", () => {
    it("returns lite-to-full when EXTERNAL upgraded to MEMBER", () => {
      expect(
        getRoleChangeType(
          OrganizationUserRole.EXTERNAL,
          undefined,
          OrganizationUserRole.MEMBER,
          undefined
        )
      ).toBe("lite-to-full");
    });

    it("returns lite-to-full when EXTERNAL upgraded to ADMIN", () => {
      expect(
        getRoleChangeType(
          OrganizationUserRole.EXTERNAL,
          undefined,
          OrganizationUserRole.ADMIN,
          undefined
        )
      ).toBe("lite-to-full");
    });

    it("returns lite-to-full when view-only custom role gets manage permission", () => {
      expect(
        getRoleChangeType(
          OrganizationUserRole.EXTERNAL,
          ["project:view"],
          OrganizationUserRole.EXTERNAL,
          ["project:view", "project:manage"]
        )
      ).toBe("lite-to-full");
    });

    it("returns lite-to-full when no permissions to non-view custom role", () => {
      expect(
        getRoleChangeType(
          OrganizationUserRole.EXTERNAL,
          undefined,
          OrganizationUserRole.EXTERNAL,
          ["project:create"]
        )
      ).toBe("lite-to-full");
    });

    it("returns lite-to-full when empty permissions to non-view custom role", () => {
      expect(
        getRoleChangeType(
          OrganizationUserRole.EXTERNAL,
          [],
          OrganizationUserRole.EXTERNAL,
          ["project:update"]
        )
      ).toBe("lite-to-full");
    });
  });

  describe("full-to-lite scenarios", () => {
    it("returns full-to-lite when MEMBER downgraded to EXTERNAL", () => {
      expect(
        getRoleChangeType(
          OrganizationUserRole.MEMBER,
          undefined,
          OrganizationUserRole.EXTERNAL,
          undefined
        )
      ).toBe("full-to-lite");
    });

    it("returns full-to-lite when ADMIN downgraded to EXTERNAL", () => {
      expect(
        getRoleChangeType(
          OrganizationUserRole.ADMIN,
          undefined,
          OrganizationUserRole.EXTERNAL,
          undefined
        )
      ).toBe("full-to-lite");
    });

    it("returns full-to-lite when MEMBER downgraded to EXTERNAL with view-only role", () => {
      expect(
        getRoleChangeType(
          OrganizationUserRole.MEMBER,
          undefined,
          OrganizationUserRole.EXTERNAL,
          ["project:view"]
        )
      ).toBe("full-to-lite");
    });

    it("returns full-to-lite when non-view custom role changed to view-only", () => {
      expect(
        getRoleChangeType(
          OrganizationUserRole.EXTERNAL,
          ["project:manage"],
          OrganizationUserRole.EXTERNAL,
          ["project:view"]
        )
      ).toBe("full-to-lite");
    });

    it("returns full-to-lite when non-view custom role removed", () => {
      expect(
        getRoleChangeType(
          OrganizationUserRole.EXTERNAL,
          ["project:update"],
          OrganizationUserRole.EXTERNAL,
          undefined
        )
      ).toBe("full-to-lite");
    });
  });
});
