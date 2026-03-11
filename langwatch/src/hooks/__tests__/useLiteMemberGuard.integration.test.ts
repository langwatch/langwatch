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

vi.mock("next/router", () => ({
  useRouter: vi.fn(),
}));

import { useOrganizationTeamProject } from "../useOrganizationTeamProject";
import { useRouter } from "next/router";

const mockUseOrganizationTeamProject = vi.mocked(useOrganizationTeamProject);
const mockUseRouter = vi.mocked(useRouter);

function setupMocks({
  organizationRole,
  pathname,
}: {
  organizationRole: OrganizationUserRole | undefined;
  pathname: string;
}) {
  mockUseOrganizationTeamProject.mockReturnValue({
    organizationRole,
  } as ReturnType<typeof useOrganizationTeamProject>);

  mockUseRouter.mockReturnValue({
    pathname,
  } as ReturnType<typeof useRouter>);
}

describe("useLiteMemberGuard()", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("when user is EXTERNAL", () => {
    describe("when on restricted route", () => {
      it("returns isRestricted true for /[project]/prompts", () => {
        setupMocks({
          organizationRole: OrganizationUserRole.EXTERNAL,
          pathname: "/[project]/prompts",
        });

        const { result } = renderHook(() => useLiteMemberGuard());

        expect(result.current.isRestricted).toBe(true);
      });

      it("returns isRestricted true for /[project]/datasets", () => {
        setupMocks({
          organizationRole: OrganizationUserRole.EXTERNAL,
          pathname: "/[project]/datasets",
        });

        const { result } = renderHook(() => useLiteMemberGuard());

        expect(result.current.isRestricted).toBe(true);
      });

      it("returns isRestricted true for /[project]/workflows", () => {
        setupMocks({
          organizationRole: OrganizationUserRole.EXTERNAL,
          pathname: "/[project]/workflows",
        });

        const { result } = renderHook(() => useLiteMemberGuard());

        expect(result.current.isRestricted).toBe(true);
      });

      it("returns isRestricted true for /[project]/messages/[trace]", () => {
        setupMocks({
          organizationRole: OrganizationUserRole.EXTERNAL,
          pathname: "/[project]/messages/[trace]",
        });

        const { result } = renderHook(() => useLiteMemberGuard());

        expect(result.current.isRestricted).toBe(true);
      });

      it("returns isRestricted true for /[project]/annotations", () => {
        setupMocks({
          organizationRole: OrganizationUserRole.EXTERNAL,
          pathname: "/[project]/annotations",
        });

        const { result } = renderHook(() => useLiteMemberGuard());

        expect(result.current.isRestricted).toBe(true);
      });
    });

    describe("when on allowed route", () => {
      it("returns isRestricted false for /[project]/analytics", () => {
        setupMocks({
          organizationRole: OrganizationUserRole.EXTERNAL,
          pathname: "/[project]/analytics",
        });

        const { result } = renderHook(() => useLiteMemberGuard());

        expect(result.current.isRestricted).toBe(false);
      });

      it("returns isRestricted false for /[project]/analytics/custom", () => {
        setupMocks({
          organizationRole: OrganizationUserRole.EXTERNAL,
          pathname: "/[project]/analytics/custom",
        });

        const { result } = renderHook(() => useLiteMemberGuard());

        expect(result.current.isRestricted).toBe(false);
      });

      it("returns isRestricted false for /[project]/messages", () => {
        setupMocks({
          organizationRole: OrganizationUserRole.EXTERNAL,
          pathname: "/[project]/messages",
        });

        const { result } = renderHook(() => useLiteMemberGuard());

        expect(result.current.isRestricted).toBe(false);
      });

      it("returns isRestricted false for /[project]/experiments", () => {
        setupMocks({
          organizationRole: OrganizationUserRole.EXTERNAL,
          pathname: "/[project]/experiments",
        });

        const { result } = renderHook(() => useLiteMemberGuard());

        expect(result.current.isRestricted).toBe(false);
      });

      it("returns isRestricted false for /[project]/simulations", () => {
        setupMocks({
          organizationRole: OrganizationUserRole.EXTERNAL,
          pathname: "/[project]/simulations",
        });

        const { result } = renderHook(() => useLiteMemberGuard());

        expect(result.current.isRestricted).toBe(false);
      });

      it("returns isRestricted false for /[project]/simulations/scenarios", () => {
        setupMocks({
          organizationRole: OrganizationUserRole.EXTERNAL,
          pathname: "/[project]/simulations/scenarios",
        });

        const { result } = renderHook(() => useLiteMemberGuard());

        expect(result.current.isRestricted).toBe(false);
      });

      it("returns isRestricted false for /[project]/evaluations", () => {
        setupMocks({
          organizationRole: OrganizationUserRole.EXTERNAL,
          pathname: "/[project]/evaluations",
        });

        const { result } = renderHook(() => useLiteMemberGuard());

        expect(result.current.isRestricted).toBe(false);
      });

      it("returns isRestricted false for /[project]", () => {
        setupMocks({
          organizationRole: OrganizationUserRole.EXTERNAL,
          pathname: "/[project]",
        });

        const { result } = renderHook(() => useLiteMemberGuard());

        expect(result.current.isRestricted).toBe(false);
      });
    });

    it("returns isLiteMember true", () => {
      setupMocks({
        organizationRole: OrganizationUserRole.EXTERNAL,
        pathname: "/[project]/analytics",
      });

      const { result } = renderHook(() => useLiteMemberGuard());

      expect(result.current.isLiteMember).toBe(true);
    });
  });

  describe("when user is MEMBER", () => {
    it("returns isLiteMember false and isRestricted false", () => {
      setupMocks({
        organizationRole: OrganizationUserRole.MEMBER,
        pathname: "/[project]/prompts",
      });

      const { result } = renderHook(() => useLiteMemberGuard());

      expect(result.current.isLiteMember).toBe(false);
      expect(result.current.isRestricted).toBe(false);
    });
  });

  describe("when user is ADMIN", () => {
    it("returns isLiteMember false and isRestricted false", () => {
      setupMocks({
        organizationRole: OrganizationUserRole.ADMIN,
        pathname: "/[project]/prompts",
      });

      const { result } = renderHook(() => useLiteMemberGuard());

      expect(result.current.isLiteMember).toBe(false);
      expect(result.current.isRestricted).toBe(false);
    });
  });

  describe("when organizationRole is undefined", () => {
    it("returns isLiteMember false and isRestricted false", () => {
      setupMocks({
        organizationRole: undefined,
        pathname: "/[project]/prompts",
      });

      const { result } = renderHook(() => useLiteMemberGuard());

      expect(result.current.isLiteMember).toBe(false);
      expect(result.current.isRestricted).toBe(false);
    });
  });
});
