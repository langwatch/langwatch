/**
 * @vitest-environment node
 * The application's `authz.*` procedures, on a process-owned tRPC root.
 * Spec: packages/features/authz/specs/package-boundary.feature
 */
import type { AuthzScopeRef, AuthzService } from "@langwatch/authz-contract";
import { initTRPC } from "@trpc/server";
import { describe, expect, it, vi } from "vitest";
import { AuthzApp } from "../../../app/authz.app";
import { AuthzTrpcApi } from "../authz.api";

const USER_ID = "user_1";
const PROJECT_ID = "project_1";
const ORGANIZATION_ID = "organization_1";
const PROJECT_SCOPE: AuthzScopeRef = { type: "project", id: PROJECT_ID } as AuthzScopeRef;

type TestContext = {
  app: { authzApp: AuthzApp };
  actor(): { id: string };
};

function harness(
  overrides: {
    tryResolveScope?: AuthzService["tryResolveScope"];
    effectivePermissions?: AuthzService["effectivePermissions"];
  } = {},
) {
  const tryResolveScope = vi.fn(overrides.tryResolveScope ?? (async () => PROJECT_SCOPE));
  const effectivePermissions = vi.fn(
    overrides.effectivePermissions ?? (async () => ["project:read"]),
  );
  const permissions = { tryResolveScope, effectivePermissions } as unknown as AuthzService;

  const trpc = initTRPC.context<TestContext>().create();
  const router = AuthzTrpcApi.create(trpc, {
    protected: trpc.procedure,
    validateOutput: true,
    policy: () => (procedure) => procedure,
  });

  return {
    permissions,
    tryResolveScope,
    effectivePermissions,
    router,
    caller: router.createCaller({
      app: { authzApp: AuthzApp.create({ permissions }) },
      actor: () => ({ id: USER_ID }),
    }),
  };
}

describe("the application's AuthZ tRPC adapter", () => {
  describe("when a procedure resolves effective permissions", () => {
    /** @scenario "Application tRPC remains a separate adapter" */
    it("delegates once to the composed contract service", async () => {
      const { caller, tryResolveScope, effectivePermissions } = harness();

      const answer = await caller.effectivePermissions({ projectId: PROJECT_ID });

      expect(tryResolveScope).toHaveBeenCalledTimes(1);
      expect(effectivePermissions).toHaveBeenCalledTimes(1);
      expect(effectivePermissions).toHaveBeenCalledWith({
        principal: { type: "user", id: USER_ID },
        scope: PROJECT_SCOPE,
      });
      expect(answer).toEqual({
        scope: { type: "project", id: PROJECT_ID },
        permissions: ["project:read"],
      });
    });

    /**
     * The narrower id decides the scope, and it is the application that
     * decides it: the adapter forwards the input it parsed and nothing else.
     */
    /** @scenario "Application tRPC remains a separate adapter" */
    it("forwards the caller's input without deciding the scope itself", async () => {
      const { caller, tryResolveScope } = harness();

      await caller.effectivePermissions({ projectId: PROJECT_ID, organizationId: ORGANIZATION_ID });

      expect(tryResolveScope).toHaveBeenCalledWith({
        projectId: PROJECT_ID,
        organizationId: undefined,
      });
    });

    /** @scenario "Application tRPC remains a separate adapter" */
    it("answers the empty set for a scope that does not resolve", async () => {
      const { caller, effectivePermissions } = harness({ tryResolveScope: async () => null });

      const answer = await caller.effectivePermissions({ projectId: "project_missing" });

      expect(answer).toEqual({ scope: null, permissions: [] });
      expect(effectivePermissions).not.toHaveBeenCalled();
    });
  });

  describe("given the mounted router", () => {
    /** @scenario "Application tRPC remains a separate adapter" */
    it("exposes only the read the surface declares", () => {
      const { router } = harness();

      expect(Object.keys(router._def.procedures)).toEqual(["effectivePermissions"]);
    });
  });
});
