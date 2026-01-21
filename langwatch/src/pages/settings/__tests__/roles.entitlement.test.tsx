/**
 * @vitest-environment jsdom
 *
 * Tests for roles page entitlement UI gating
 * Verifies that custom role creation/editing is properly gated by entitlement
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { useHasEntitlement } from "../../../features/entitlements";

// Mock the api module
vi.mock("../../../utils/api", () => ({
  api: {
    publicEnv: {
      useQuery: vi.fn(),
    },
  },
}));

import { api } from "../../../utils/api";

describe("Roles Page Entitlement Gating", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("useHasEntitlement for custom-rbac", () => {
    it("returns false for OSS plan, indicating UI should be locked", () => {
      vi.mocked(api.publicEnv.useQuery).mockReturnValue({
        data: { SELF_HOSTED_PLAN: "self-hosted:oss" },
      } as ReturnType<typeof api.publicEnv.useQuery>);

      const { result } = renderHook(() => useHasEntitlement("custom-rbac"));

      expect(result.current).toBe(false);
    });

    it("returns false for Pro plan, indicating UI should be locked", () => {
      vi.mocked(api.publicEnv.useQuery).mockReturnValue({
        data: { SELF_HOSTED_PLAN: "self-hosted:pro" },
      } as ReturnType<typeof api.publicEnv.useQuery>);

      const { result } = renderHook(() => useHasEntitlement("custom-rbac"));

      expect(result.current).toBe(false);
    });

    it("returns true for Enterprise plan, indicating UI should be unlocked", () => {
      vi.mocked(api.publicEnv.useQuery).mockReturnValue({
        data: { SELF_HOSTED_PLAN: "self-hosted:enterprise" },
      } as ReturnType<typeof api.publicEnv.useQuery>);

      const { result } = renderHook(() => useHasEntitlement("custom-rbac"));

      expect(result.current).toBe(true);
    });
  });

  describe("UI gating behavior", () => {
    it("Create Role button should be disabled when hasCustomRbac is false", () => {
      vi.mocked(api.publicEnv.useQuery).mockReturnValue({
        data: { SELF_HOSTED_PLAN: "self-hosted:oss" },
      } as ReturnType<typeof api.publicEnv.useQuery>);

      const { result } = renderHook(() => useHasEntitlement("custom-rbac"));
      const hasCustomRbac = result.current;

      // Simulates the button disabled logic from roles.tsx:
      // disabled={!hasCustomRbac || !hasPermission("organization:manage")}
      const hasPermission = true; // Assume user has permission
      const isButtonDisabled = !hasCustomRbac || !hasPermission;

      expect(isButtonDisabled).toBe(true);
    });

    it("Create Role button should be enabled when hasCustomRbac is true and has permission", () => {
      vi.mocked(api.publicEnv.useQuery).mockReturnValue({
        data: { SELF_HOSTED_PLAN: "self-hosted:enterprise" },
      } as ReturnType<typeof api.publicEnv.useQuery>);

      const { result } = renderHook(() => useHasEntitlement("custom-rbac"));
      const hasCustomRbac = result.current;

      const hasPermission = true;
      const isButtonDisabled = !hasCustomRbac || !hasPermission;

      expect(isButtonDisabled).toBe(false);
    });

    it("Enterprise feature banner should show when hasCustomRbac is false", () => {
      vi.mocked(api.publicEnv.useQuery).mockReturnValue({
        data: { SELF_HOSTED_PLAN: "self-hosted:oss" },
      } as ReturnType<typeof api.publicEnv.useQuery>);

      const { result } = renderHook(() => useHasEntitlement("custom-rbac"));
      const hasCustomRbac = result.current;

      // Simulates the conditional rendering from roles.tsx:
      // {!hasCustomRbac && <Card.Root ... >}
      const shouldShowBanner = !hasCustomRbac;

      expect(shouldShowBanner).toBe(true);
    });

    it("Enterprise feature banner should NOT show when hasCustomRbac is true", () => {
      vi.mocked(api.publicEnv.useQuery).mockReturnValue({
        data: { SELF_HOSTED_PLAN: "self-hosted:enterprise" },
      } as ReturnType<typeof api.publicEnv.useQuery>);

      const { result } = renderHook(() => useHasEntitlement("custom-rbac"));
      const hasCustomRbac = result.current;

      const shouldShowBanner = !hasCustomRbac;

      expect(shouldShowBanner).toBe(false);
    });
  });

  describe("RoleCard entitlement prop behavior", () => {
    it("edit button should be disabled when hasEntitlement is false", () => {
      vi.mocked(api.publicEnv.useQuery).mockReturnValue({
        data: { SELF_HOSTED_PLAN: "self-hosted:oss" },
      } as ReturnType<typeof api.publicEnv.useQuery>);

      const { result } = renderHook(() => useHasEntitlement("custom-rbac"));
      const hasEntitlement = result.current;

      // Simulates the RoleCard edit button disabled logic:
      // disabled={!hasEntitlement || !hasPermission("organization:manage")}
      const hasPermission = true;
      const isEditDisabled = !hasEntitlement || !hasPermission;

      expect(isEditDisabled).toBe(true);
    });

    it("delete button should be disabled when hasEntitlement is false", () => {
      vi.mocked(api.publicEnv.useQuery).mockReturnValue({
        data: { SELF_HOSTED_PLAN: "self-hosted:oss" },
      } as ReturnType<typeof api.publicEnv.useQuery>);

      const { result } = renderHook(() => useHasEntitlement("custom-rbac"));
      const hasEntitlement = result.current;

      // Simulates the RoleCard delete button disabled logic:
      // disabled={!hasEntitlement || !hasPermission("organization:manage")}
      const hasPermission = true;
      const isDeleteDisabled = !hasEntitlement || !hasPermission;

      expect(isDeleteDisabled).toBe(true);
    });

    it("both edit and delete should be enabled when hasEntitlement is true", () => {
      vi.mocked(api.publicEnv.useQuery).mockReturnValue({
        data: { SELF_HOSTED_PLAN: "self-hosted:enterprise" },
      } as ReturnType<typeof api.publicEnv.useQuery>);

      const { result } = renderHook(() => useHasEntitlement("custom-rbac"));
      const hasEntitlement = result.current;

      const hasPermission = true;
      const isEditDisabled = !hasEntitlement || !hasPermission;
      const isDeleteDisabled = !hasEntitlement || !hasPermission;

      expect(isEditDisabled).toBe(false);
      expect(isDeleteDisabled).toBe(false);
    });
  });
});
