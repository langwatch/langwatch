import { describe, expect, it } from "vitest";
import { OrganizationUserRole } from "@langwatch/prisma-client/generated";
import { MemberClassificationService } from "../member-classification.service";

/**
 * Unit tests for member classification functions.
 */

describe("isViewOnlyPermission", () => {
  it("returns true for view permission", () => {
    expect(MemberClassificationService.isViewOnlyPermission("project:view")).toBe(true);
    expect(MemberClassificationService.isViewOnlyPermission("analytics:view")).toBe(true);
    expect(MemberClassificationService.isViewOnlyPermission("traces:view")).toBe(true);
  });

  it("returns false for manage permission", () => {
    expect(MemberClassificationService.isViewOnlyPermission("project:manage")).toBe(false);
    expect(MemberClassificationService.isViewOnlyPermission("analytics:manage")).toBe(false);
  });

  it("returns false for create permission", () => {
    expect(MemberClassificationService.isViewOnlyPermission("project:create")).toBe(false);
  });

  it("returns false for update permission", () => {
    expect(MemberClassificationService.isViewOnlyPermission("project:update")).toBe(false);
  });

  it("returns false for delete permission", () => {
    expect(MemberClassificationService.isViewOnlyPermission("project:delete")).toBe(false);
  });

  it("returns false for share permission", () => {
    expect(MemberClassificationService.isViewOnlyPermission("traces:share")).toBe(false);
  });

  it("handles edge cases with malformed permissions", () => {
    expect(MemberClassificationService.isViewOnlyPermission("view")).toBe(false); // No colon
    expect(MemberClassificationService.isViewOnlyPermission("")).toBe(false); // Empty string
    expect(MemberClassificationService.isViewOnlyPermission("project:")).toBe(false); // Missing action
  });
});

describe("isViewOnlyCustomRole", () => {
  it("returns true when all permissions are view-only", () => {
    expect(
      MemberClassificationService.isViewOnlyCustomRole([
        "project:view",
        "analytics:view",
        "traces:view",
      ]),
    ).toBe(true);
  });

  it("returns true for single view-only permission", () => {
    expect(MemberClassificationService.isViewOnlyCustomRole(["project:view"])).toBe(true);
  });

  it("returns false when any permission is manage", () => {
    expect(
      MemberClassificationService.isViewOnlyCustomRole(["project:view", "project:manage"]),
    ).toBe(false);
  });

  it("returns false when any permission is create", () => {
    expect(
      MemberClassificationService.isViewOnlyCustomRole(["project:view", "project:create"]),
    ).toBe(false);
  });

  it("returns false when any permission is update", () => {
    expect(
      MemberClassificationService.isViewOnlyCustomRole(["project:view", "project:update"]),
    ).toBe(false);
  });

  it("returns false when any permission is delete", () => {
    expect(
      MemberClassificationService.isViewOnlyCustomRole(["project:view", "project:delete"]),
    ).toBe(false);
  });

  it("returns false when any permission is share", () => {
    expect(MemberClassificationService.isViewOnlyCustomRole(["traces:view", "traces:share"])).toBe(
      false,
    );
  });

  it("returns true for empty permissions array", () => {
    expect(MemberClassificationService.isViewOnlyCustomRole([])).toBe(true);
  });
});

describe("classifyMemberType", () => {
  describe("role-based classification", () => {
    /** @scenario ADMIN role users count as Full Member */
    it("returns FullMember for ADMIN role", () => {
      expect(
        MemberClassificationService.classifyMemberType(OrganizationUserRole.ADMIN, undefined),
      ).toBe("FullMember");
    });

    it("returns FullMember for ADMIN role even with view-only permissions", () => {
      expect(
        MemberClassificationService.classifyMemberType(OrganizationUserRole.ADMIN, [
          "project:view",
        ]),
      ).toBe("FullMember");
    });

    /** @scenario MEMBER role users count as Full Member */
    it("returns FullMember for MEMBER role", () => {
      expect(
        MemberClassificationService.classifyMemberType(OrganizationUserRole.MEMBER, undefined),
      ).toBe("FullMember");
    });

    it("returns FullMember for MEMBER role even with view-only permissions", () => {
      expect(
        MemberClassificationService.classifyMemberType(OrganizationUserRole.MEMBER, [
          "project:view",
        ]),
      ).toBe("FullMember");
    });

    it("returns LiteMember for EXTERNAL role with no permissions (Lite Member)", () => {
      expect(
        MemberClassificationService.classifyMemberType(OrganizationUserRole.EXTERNAL, undefined),
      ).toBe("LiteMember");
    });
  });

  describe("EXTERNAL role (Lite Member) with custom permissions", () => {
    /** @scenario Custom role with only view permissions counts as Lite Member */
    it("returns LiteMember for view-only permissions", () => {
      expect(
        MemberClassificationService.classifyMemberType(OrganizationUserRole.EXTERNAL, [
          "project:view",
        ]),
      ).toBe("LiteMember");
    });

    it("returns LiteMember for multiple view-only permissions", () => {
      expect(
        MemberClassificationService.classifyMemberType(OrganizationUserRole.EXTERNAL, [
          "project:view",
          "analytics:view",
          "traces:view",
        ]),
      ).toBe("LiteMember");
    });

    /** @scenario Custom role with manage permission counts as Full Member */
    it("returns FullMember for manage permission", () => {
      expect(
        MemberClassificationService.classifyMemberType(OrganizationUserRole.EXTERNAL, [
          "project:view",
          "project:manage",
        ]),
      ).toBe("FullMember");
    });

    /** @scenario Custom role with create permission counts as Full Member */
    it("returns FullMember for create permission", () => {
      expect(
        MemberClassificationService.classifyMemberType(OrganizationUserRole.EXTERNAL, [
          "project:view",
          "project:create",
        ]),
      ).toBe("FullMember");
    });

    /** @scenario Custom role with update permission counts as Full Member */
    it("returns FullMember for update permission", () => {
      expect(
        MemberClassificationService.classifyMemberType(OrganizationUserRole.EXTERNAL, [
          "project:view",
          "project:update",
        ]),
      ).toBe("FullMember");
    });

    /** @scenario Custom role with delete permission counts as Full Member */
    it("returns FullMember for delete permission", () => {
      expect(
        MemberClassificationService.classifyMemberType(OrganizationUserRole.EXTERNAL, [
          "project:view",
          "project:delete",
        ]),
      ).toBe("FullMember");
    });

    /** @scenario Custom role with share permission counts as Full Member */
    it("returns FullMember for share permission", () => {
      expect(
        MemberClassificationService.classifyMemberType(OrganizationUserRole.EXTERNAL, [
          "traces:view",
          "traces:share",
        ]),
      ).toBe("FullMember");
    });

    it("returns LiteMember for empty permissions array", () => {
      expect(
        MemberClassificationService.classifyMemberType(OrganizationUserRole.EXTERNAL, []),
      ).toBe("LiteMember");
    });
  });
});

describe("isFullMember", () => {
  it("returns true for ADMIN role", () => {
    expect(MemberClassificationService.isFullMember(OrganizationUserRole.ADMIN, undefined)).toBe(
      true,
    );
  });

  it("returns true for MEMBER role", () => {
    expect(MemberClassificationService.isFullMember(OrganizationUserRole.MEMBER, undefined)).toBe(
      true,
    );
  });

  it("returns true for EXTERNAL with non-view permissions", () => {
    expect(
      MemberClassificationService.isFullMember(OrganizationUserRole.EXTERNAL, [
        "project:view",
        "project:manage",
      ]),
    ).toBe(true);
  });

  it("returns false for EXTERNAL with view-only permissions", () => {
    expect(
      MemberClassificationService.isFullMember(OrganizationUserRole.EXTERNAL, ["project:view"]),
    ).toBe(false);
  });

  it("returns false for EXTERNAL with no permissions", () => {
    expect(MemberClassificationService.isFullMember(OrganizationUserRole.EXTERNAL, undefined)).toBe(
      false,
    );
  });
});

describe("isLiteMember", () => {
  it("returns false for ADMIN role", () => {
    expect(MemberClassificationService.isLiteMember(OrganizationUserRole.ADMIN, undefined)).toBe(
      false,
    );
  });

  it("returns false for MEMBER role", () => {
    expect(MemberClassificationService.isLiteMember(OrganizationUserRole.MEMBER, undefined)).toBe(
      false,
    );
  });

  it("returns false for EXTERNAL with non-view permissions", () => {
    expect(
      MemberClassificationService.isLiteMember(OrganizationUserRole.EXTERNAL, [
        "project:view",
        "project:manage",
      ]),
    ).toBe(false);
  });

  it("returns true for EXTERNAL with view-only permissions", () => {
    expect(
      MemberClassificationService.isLiteMember(OrganizationUserRole.EXTERNAL, ["project:view"]),
    ).toBe(true);
  });

  it("returns true for EXTERNAL with no permissions", () => {
    expect(MemberClassificationService.isLiteMember(OrganizationUserRole.EXTERNAL, undefined)).toBe(
      true,
    );
  });

  it("returns true for EXTERNAL with empty permissions array", () => {
    expect(MemberClassificationService.isLiteMember(OrganizationUserRole.EXTERNAL, [])).toBe(true);
  });
});

describe("getRoleChangeType", () => {
  describe("no-change scenarios", () => {
    it("returns no-change when both roles are Full Member (ADMIN to MEMBER)", () => {
      expect(
        MemberClassificationService.getRoleChangeType(
          OrganizationUserRole.ADMIN,
          undefined,
          OrganizationUserRole.MEMBER,
          undefined,
        ),
      ).toBe("no-change");
    });

    it("returns no-change when both roles are Full Member (MEMBER to ADMIN)", () => {
      expect(
        MemberClassificationService.getRoleChangeType(
          OrganizationUserRole.MEMBER,
          undefined,
          OrganizationUserRole.ADMIN,
          undefined,
        ),
      ).toBe("no-change");
    });

    it("returns no-change when both roles are Lite Member (EXTERNAL to EXTERNAL)", () => {
      expect(
        MemberClassificationService.getRoleChangeType(
          OrganizationUserRole.EXTERNAL,
          undefined,
          OrganizationUserRole.EXTERNAL,
          ["project:view"],
        ),
      ).toBe("no-change");
    });

    it("returns no-change when EXTERNAL with non-view to MEMBER (both Full Member)", () => {
      expect(
        MemberClassificationService.getRoleChangeType(
          OrganizationUserRole.EXTERNAL,
          ["project:manage"],
          OrganizationUserRole.MEMBER,
          undefined,
        ),
      ).toBe("no-change");
    });

    it("returns no-change when custom role changes but stays view-only", () => {
      expect(
        MemberClassificationService.getRoleChangeType(
          OrganizationUserRole.EXTERNAL,
          ["project:view"],
          OrganizationUserRole.EXTERNAL,
          ["project:view", "analytics:view"],
        ),
      ).toBe("no-change");
    });

    it("returns no-change when custom role changes but stays non-view", () => {
      expect(
        MemberClassificationService.getRoleChangeType(
          OrganizationUserRole.EXTERNAL,
          ["project:manage"],
          OrganizationUserRole.EXTERNAL,
          ["project:update"],
        ),
      ).toBe("no-change");
    });
  });

  describe("lite-to-full scenarios", () => {
    it("returns lite-to-full when EXTERNAL upgraded to MEMBER", () => {
      expect(
        MemberClassificationService.getRoleChangeType(
          OrganizationUserRole.EXTERNAL,
          undefined,
          OrganizationUserRole.MEMBER,
          undefined,
        ),
      ).toBe("lite-to-full");
    });

    it("returns lite-to-full when EXTERNAL upgraded to ADMIN", () => {
      expect(
        MemberClassificationService.getRoleChangeType(
          OrganizationUserRole.EXTERNAL,
          undefined,
          OrganizationUserRole.ADMIN,
          undefined,
        ),
      ).toBe("lite-to-full");
    });

    it("returns lite-to-full when view-only custom role gets manage permission", () => {
      expect(
        MemberClassificationService.getRoleChangeType(
          OrganizationUserRole.EXTERNAL,
          ["project:view"],
          OrganizationUserRole.EXTERNAL,
          ["project:view", "project:manage"],
        ),
      ).toBe("lite-to-full");
    });

    it("returns lite-to-full when no permissions to non-view custom role", () => {
      expect(
        MemberClassificationService.getRoleChangeType(
          OrganizationUserRole.EXTERNAL,
          undefined,
          OrganizationUserRole.EXTERNAL,
          ["project:create"],
        ),
      ).toBe("lite-to-full");
    });

    it("returns lite-to-full when empty permissions to non-view custom role", () => {
      expect(
        MemberClassificationService.getRoleChangeType(
          OrganizationUserRole.EXTERNAL,
          [],
          OrganizationUserRole.EXTERNAL,
          ["project:update"],
        ),
      ).toBe("lite-to-full");
    });
  });

  describe("full-to-lite scenarios", () => {
    it("returns full-to-lite when MEMBER downgraded to EXTERNAL", () => {
      expect(
        MemberClassificationService.getRoleChangeType(
          OrganizationUserRole.MEMBER,
          undefined,
          OrganizationUserRole.EXTERNAL,
          undefined,
        ),
      ).toBe("full-to-lite");
    });

    it("returns full-to-lite when ADMIN downgraded to EXTERNAL", () => {
      expect(
        MemberClassificationService.getRoleChangeType(
          OrganizationUserRole.ADMIN,
          undefined,
          OrganizationUserRole.EXTERNAL,
          undefined,
        ),
      ).toBe("full-to-lite");
    });

    it("returns full-to-lite when MEMBER downgraded to EXTERNAL with view-only role", () => {
      expect(
        MemberClassificationService.getRoleChangeType(
          OrganizationUserRole.MEMBER,
          undefined,
          OrganizationUserRole.EXTERNAL,
          ["project:view"],
        ),
      ).toBe("full-to-lite");
    });

    it("returns full-to-lite when non-view custom role changed to view-only", () => {
      expect(
        MemberClassificationService.getRoleChangeType(
          OrganizationUserRole.EXTERNAL,
          ["project:manage"],
          OrganizationUserRole.EXTERNAL,
          ["project:view"],
        ),
      ).toBe("full-to-lite");
    });

    it("returns full-to-lite when non-view custom role removed", () => {
      expect(
        MemberClassificationService.getRoleChangeType(
          OrganizationUserRole.EXTERNAL,
          ["project:update"],
          OrganizationUserRole.EXTERNAL,
          undefined,
        ),
      ).toBe("full-to-lite");
    });
  });
});
