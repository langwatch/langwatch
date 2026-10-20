/**
 * @vitest-environment jsdom
 *
 * Langy's visibility gate in the Explorer, which decides whether the ask button reads Ask Langy.
 * @see specs/traces-v2/search.feature
 */
import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useLangyVisibility } from "../use-show-langy.ts";

const state = vi.hoisted(() => ({
  permissions: new Set<string>(),
  flag: true,
  demoProjectSlug: undefined as string | undefined,
}));

vi.mock("../../../../../behavior/auth-session.ts", () => ({
  useRequiredSession: () => ({ data: { user: { id: "user-1" } }, status: "authenticated" }),
}));
vi.mock("../../../../../behavior/trace-host.ts", () => ({
  useTraceHost: () => ({
    hasPermission: (permission: string) => state.permissions.has(permission),
    isLoading: () => false,
  }),
}));
// The host names the team and nothing else: no member list, no organization role.
vi.mock("../../../../../behavior/use-organization-team-project.ts", () => ({
  useOrganizationTeamProject: () => ({
    project: { id: "project-1", slug: "acme" },
    organization: { id: "organization-1" },
    team: { id: "team-1" },
    organizationRole: undefined,
  }),
}));
vi.mock("@langwatch/browser-host/capabilities", () => ({
  useUiDeployment: () => ({ demoProjectSlug: state.demoProjectSlug }),
}));
vi.mock("@langwatch/feature-flag-client", () => ({
  useFeatureFlag: (_flag: unknown, options: { enabled?: boolean }) => ({
    enabled: options.enabled !== false && state.flag,
    isLoading: false,
  }),
}));

beforeEach(() => {
  state.permissions = new Set(["langy:view"]);
  state.flag = true;
  state.demoProjectSlug = undefined;
});

describe("useLangyVisibility", () => {
  describe("given a reader holding langy:view on a released project", () => {
    /** @scenario "The ask button reads Ask Langy" */
    it("shows Langy though the host carries no member list", () => {
      expect(renderHook(() => useLangyVisibility()).result.current.show).toBe(true);
    });
  });

  describe("given a reader without langy:view", () => {
    it("hides Langy", () => {
      state.permissions = new Set();
      expect(renderHook(() => useLangyVisibility()).result.current.show).toBe(false);
    });
  });

  describe("given the demo project", () => {
    it("hides Langy", () => {
      state.demoProjectSlug = "acme";
      expect(renderHook(() => useLangyVisibility()).result.current.show).toBe(false);
    });
  });

  describe("given the release flag is off", () => {
    it("hides Langy", () => {
      state.flag = false;
      expect(renderHook(() => useLangyVisibility()).result.current.show).toBe(false);
    });
  });
});
