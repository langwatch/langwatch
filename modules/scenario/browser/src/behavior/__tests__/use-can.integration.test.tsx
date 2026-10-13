/**
 * @vitest-environment jsdom
 * Agent Testing asks the session, through scenario's host, and sends no grant read of its own.
 * Spec: specs/frontend/session-permission-reads.feature (scope knot, plan batch 4c).
 */
import { permissionSatisfiedBy } from "@langwatch/authorization";
import { cleanup, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ScenarioHostApi, ScenarioHostProvider } from "../../model/scenario-host.ts";

const { mockEffectivePermissionsQuery } = vi.hoisted(() => ({
  mockEffectivePermissionsQuery: vi.fn(),
}));

vi.mock("../scenario-api.ts", () => ({
  api: { authz: { effectivePermissions: { useQuery: mockEffectivePermissionsQuery } } },
}));

const { useCan } = await import("../use-can.ts");

/** A host whose answer is the session's: a fixed grant set, read with the engine's helper. */
class SessionScenarioHost extends ScenarioHostApi {
  constructor(private readonly granted: readonly string[]) {
    super();
  }
  project() {
    return { id: "proj_1", slug: "acme", name: "Acme" };
  }
  organization() {
    return { id: "org_1" };
  }
  team() {
    return { id: "team_1" };
  }
  organizationRole() {
    return void 0;
  }
  currentUser() {
    return void 0;
  }
  hasPermission(permission: string) {
    return permissionSatisfiedBy({ granted: new Set(this.granted), requested: permission });
  }
  isLoading() {
    return false;
  }
  route() {
    return { params: {}, query: {}, pathname: "/acme/simulations" };
  }
  setQuery() {}
  navigate() {}
  succeeded() {}
  failed() {}
}

const renderCan = ({ granted }: { granted: readonly string[] }) => {
  const host = new SessionScenarioHost(granted);
  return renderHook(() => useCan(), {
    wrapper: ({ children }: { children: ReactNode }) => (
      <ScenarioHostProvider value={host}>{children}</ScenarioHostProvider>
    ),
  });
};

afterEach(cleanup);

describe("useCan", () => {
  describe("given the session has answered the reader's grants in the active project", () => {
    /** @scenario "Agent Testing asks the session rather than sending its own grant read" */
    it("offers what the session grants and sends no second grant read", () => {
      const { result } = renderCan({ granted: ["datasets:manage"] });

      expect(result.current.can("datasets:view")).toBe(true);
      expect(result.current.can("datasets:manage")).toBe(true);
      expect(result.current.can("prompts:view")).toBe(false);
      expect(mockEffectivePermissionsQuery).not.toHaveBeenCalled();
    });

    it("never reads a grant backwards, so view does not imply manage", () => {
      const { result } = renderCan({ granted: ["datasets:view"] });

      expect(result.current.can("datasets:manage")).toBe(false);
    });
  });

  describe("given a session with no grants yet", () => {
    it("refuses everything", () => {
      const { result } = renderCan({ granted: [] });

      expect(result.current.can("datasets:view")).toBe(false);
    });
  });
});
