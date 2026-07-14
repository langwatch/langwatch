/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { OrganizationUserRole } from "@prisma/client";
import { useLiteMemberGuard } from "../useLiteMemberGuard";

vi.mock("../useOrganizationTeamProject", () => ({
  useOrganizationTeamProject: vi.fn(),
}));

import { useOrganizationTeamProject } from "../useOrganizationTeamProject";

const mockUseOrganizationTeamProject = vi.mocked(useOrganizationTeamProject);

function setupMocks({
  organizationRole,
}: {
  organizationRole: OrganizationUserRole | undefined;
}) {
  mockUseOrganizationTeamProject.mockReturnValue({
    organizationRole,
  } as ReturnType<typeof useOrganizationTeamProject>);
}

describe("useLiteMemberGuard()", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("when user is EXTERNAL", () => {
    it("returns isLiteMember true", () => {
      setupMocks({
        organizationRole: OrganizationUserRole.EXTERNAL,
      });

      const { result } = renderHook(() => useLiteMemberGuard());

      expect(result.current.isLiteMember).toBe(true);
    });

    it("does not return isRestricted", () => {
      setupMocks({
        organizationRole: OrganizationUserRole.EXTERNAL,
      });

      const { result } = renderHook(() => useLiteMemberGuard());

      expect(result.current).not.toHaveProperty("isRestricted");
    });
  });

  describe("when user is MEMBER", () => {
    it("returns isLiteMember false", () => {
      setupMocks({
        organizationRole: OrganizationUserRole.MEMBER,
      });

      const { result } = renderHook(() => useLiteMemberGuard());

      expect(result.current.isLiteMember).toBe(false);
    });
  });

  describe("when user is ADMIN", () => {
    it("returns isLiteMember false", () => {
      setupMocks({
        organizationRole: OrganizationUserRole.ADMIN,
      });

      const { result } = renderHook(() => useLiteMemberGuard());

      expect(result.current.isLiteMember).toBe(false);
    });
  });

  describe("when organizationRole is undefined", () => {
    it("returns isLiteMember false", () => {
      setupMocks({
        organizationRole: undefined,
      });

      const { result } = renderHook(() => useLiteMemberGuard());

      expect(result.current.isLiteMember).toBe(false);
    });
  });
});
