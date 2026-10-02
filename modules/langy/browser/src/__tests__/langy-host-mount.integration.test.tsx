/** @vitest-environment jsdom */
import { renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

let isSaaS = true;
let role: string | undefined = "MEMBER";
let granted: string[] = ["langy:view"];
let projectSlug = "acme";

const session = {
  snapshot: () => ({
    scope: {
      status: "ready",
      project: { id: "project_1", slug: projectSlug, name: "Acme" },
      organization: { id: "org_1", name: "Org" },
      team: { id: "team_1", name: "Team" },
    },
  }),
  currentUser: () => ({ id: "user_1", name: "Member", email: "m@example.com", image: null }),
  hasPermission: (permission: string) => granted.includes(permission),
  featureFlag: () => true,
};

vi.mock("@langwatch/browser-host/capabilities", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useUiCapabilities: () => ({ session, navigation: {}, route: {}, feedback: {} }),
  useUiDeployment: () => ({ isSaaS, demoProjectSlug: "demo" }),
  useUiScope: () => ({ scopeHost: () => ({ organizationRole: () => role }) }),
}));

const { default: LangyHostMount } = await import("../behavior/langy-host-mount.tsx");
const { usePlanManagementUrl } = await import("../behavior/use-plan-management-url.ts");
const { useLangyVisibility } = await import("../features/langy/behavior/use-show-langy.ts");

const wrapper = ({ children }: { children: ReactNode }) => (
  <LangyHostMount>{children}</LangyHostMount>
);

describe("LangyHostMount", () => {
  beforeEach(() => {
    isSaaS = true;
    role = "MEMBER";
    granted = ["langy:view"];
    projectSlug = "acme";
  });

  describe("when the deployment is SaaS", () => {
    it("links the plan limit to the subscription page", () => {
      const { result } = renderHook(() => usePlanManagementUrl(), { wrapper });
      expect(result.current).toEqual({
        url: "/settings/subscription",
        buttonLabel: "Upgrade plan",
        isSaaS: true,
        isLoading: false,
      });
    });
  });

  describe("when the deployment is self-hosted", () => {
    it("links the plan limit to the licence page", () => {
      isSaaS = false;
      const { result } = renderHook(() => usePlanManagementUrl(), { wrapper });
      expect(result.current.url).toBe("/settings/license");
      expect(result.current.buttonLabel).toBe("Upgrade license");
    });
  });

  describe("given a team member who is not an organisation admin", () => {
    it("shows Langy when they hold langy:view", () => {
      const { result } = renderHook(() => useLangyVisibility(), { wrapper });
      expect(result.current.show).toBe(true);
    });

    it("hides Langy without langy:view", () => {
      granted = [];
      const { result } = renderHook(() => useLangyVisibility(), { wrapper });
      expect(result.current.show).toBe(false);
    });

    it("hides Langy on the demo project", () => {
      projectSlug = "demo";
      const { result } = renderHook(() => useLangyVisibility(), { wrapper });
      expect(result.current.show).toBe(false);
    });
  });
});
