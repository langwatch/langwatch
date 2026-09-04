import { renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it } from "vitest";

import {
  createUiScopeHost,
  UiScopeHostProvider,
  useOrganizationTeamProject,
} from "../use-organization-team-project";

const host = createUiScopeHost({
  project: () => ({ id: "project_1", name: "Checkout", slug: "checkout" }),
  organization: () => ({ id: "organization_1" }),
  team: () => ({ id: "team_1" }),
  organizationRole: () => "ADMIN",
  hasPermission: (permission) => permission === "TRACES_VIEW",
  isLoading: () => false,
});

function withHost({ children }: { children: ReactNode }) {
  return <UiScopeHostProvider value={host}>{children}</UiScopeHostProvider>;
}

describe("useOrganizationTeamProject", () => {
  describe("when a scope host is mounted above it", () => {
    it("reads the scope the host resolved", () => {
      const { result } = renderHook(() => useOrganizationTeamProject(), { wrapper: withHost });

      expect(result.current.project?.id).toBe("project_1");
      expect(result.current.projectId).toBe("project_1");
      expect(result.current.organization?.id).toBe("organization_1");
      expect(result.current.team?.id).toBe("team_1");
      expect(result.current.organizationRole).toBe("ADMIN");
      expect(result.current.isResolved).toBe(true);
    });

    it("fails closed on a grant the reader does not hold", () => {
      const { result } = renderHook(() => useOrganizationTeamProject(), { wrapper: withHost });

      expect(result.current.hasPermission("TRACES_VIEW")).toBe(true);
      expect(result.current.hasPermission("PROJECT_DELETE")).toBe(false);
    });
  });

  describe("when no scope host is mounted", () => {
    it("answers an unresolved scope instead of throwing (D20)", () => {
      const { result } = renderHook(() => useOrganizationTeamProject());

      expect(result.current.project).toBeUndefined();
      expect(result.current.isResolved).toBe(false);
      expect(result.current.isLoading).toBe(false);
      expect(result.current.hasPermission("TRACES_VIEW")).toBe(false);
    });
  });

  describe("when a caller passes the old redirect options", () => {
    it("accepts them and navigates nowhere", () => {
      const { result } = renderHook(
        () => useOrganizationTeamProject({ redirectToOnboarding: true }),
        { wrapper: withHost },
      );

      expect(result.current.project?.slug).toBe("checkout");
    });
  });
});
