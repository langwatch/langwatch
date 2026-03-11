/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { OrganizationUserRole } from "@prisma/client";
import { useTraceDetailsDrawer } from "../useTraceDetailsDrawer";

vi.mock("../useOrganizationTeamProject", () => ({
  useOrganizationTeamProject: vi.fn(),
}));

vi.mock("../useDrawer", () => ({
  useDrawer: vi.fn(),
}));

vi.mock("../../stores/upgradeModalStore", () => ({
  useUpgradeModalStore: vi.fn(),
}));

import { useOrganizationTeamProject } from "../useOrganizationTeamProject";
import { useDrawer } from "../useDrawer";
import { useUpgradeModalStore } from "../../stores/upgradeModalStore";

const mockUseOrganizationTeamProject = vi.mocked(useOrganizationTeamProject);
const mockUseDrawer = vi.mocked(useDrawer);
const mockUseUpgradeModalStore = vi.mocked(useUpgradeModalStore);

const mockOpenDrawer = vi.fn();
const mockOpenLiteMemberRestriction = vi.fn();

function setupMocks({
  organizationRole,
}: {
  organizationRole: OrganizationUserRole | undefined;
}) {
  mockUseOrganizationTeamProject.mockReturnValue({
    organizationRole,
  } as ReturnType<typeof useOrganizationTeamProject>);

  mockUseDrawer.mockReturnValue({
    openDrawer: mockOpenDrawer,
  } as unknown as ReturnType<typeof useDrawer>);

  mockUseUpgradeModalStore.mockReturnValue({
    openLiteMemberRestriction: mockOpenLiteMemberRestriction,
  } as unknown as ReturnType<typeof useUpgradeModalStore>);
}

describe("useTraceDetailsDrawer()", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("when user is EXTERNAL", () => {
    it("opens lite member restriction modal", () => {
      setupMocks({ organizationRole: OrganizationUserRole.EXTERNAL });

      const { result } = renderHook(() => useTraceDetailsDrawer());

      act(() => {
        result.current.openTraceDetailsDrawer();
      });

      expect(mockOpenLiteMemberRestriction).toHaveBeenCalledWith({
        resource: "traces",
      });
    });

    it("does not open the drawer", () => {
      setupMocks({ organizationRole: OrganizationUserRole.EXTERNAL });

      const { result } = renderHook(() => useTraceDetailsDrawer());

      act(() => {
        result.current.openTraceDetailsDrawer();
      });

      expect(mockOpenDrawer).not.toHaveBeenCalled();
    });
  });

  describe("when user is MEMBER", () => {
    it("delegates to openDrawer with traceDetails", () => {
      setupMocks({ organizationRole: OrganizationUserRole.MEMBER });

      const traceProps = { traceId: "trace-123" };
      const { result } = renderHook(() => useTraceDetailsDrawer());

      act(() => {
        result.current.openTraceDetailsDrawer(traceProps as any);
      });

      expect(mockOpenDrawer).toHaveBeenCalledWith("traceDetails", traceProps);
      expect(mockOpenLiteMemberRestriction).not.toHaveBeenCalled();
    });
  });

  describe("when user is ADMIN", () => {
    it("delegates to openDrawer with traceDetails", () => {
      setupMocks({ organizationRole: OrganizationUserRole.ADMIN });

      const traceProps = { traceId: "trace-456" };
      const { result } = renderHook(() => useTraceDetailsDrawer());

      act(() => {
        result.current.openTraceDetailsDrawer(traceProps as any);
      });

      expect(mockOpenDrawer).toHaveBeenCalledWith("traceDetails", traceProps);
      expect(mockOpenLiteMemberRestriction).not.toHaveBeenCalled();
    });
  });

  describe("when organizationRole is undefined", () => {
    it("delegates to openDrawer with traceDetails", () => {
      setupMocks({ organizationRole: undefined });

      const { result } = renderHook(() => useTraceDetailsDrawer());

      act(() => {
        result.current.openTraceDetailsDrawer();
      });

      expect(mockOpenDrawer).toHaveBeenCalledWith("traceDetails", undefined);
      expect(mockOpenLiteMemberRestriction).not.toHaveBeenCalled();
    });
  });
});
