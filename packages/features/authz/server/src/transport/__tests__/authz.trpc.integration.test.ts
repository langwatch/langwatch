/**
 * @vitest-environment node
 * The application's `authz.*` procedures, bound to a declaration a process
 * mounts on its own tRPC runtime.
 * Spec: packages/features/authz/specs/package-boundary.feature
 */
import type { AuthzApi, AuthzScopeRef, AuthzService } from "@langwatch/authz-contract";
import type { TrpcContractHandlerArguments, TrpcProcedureFactory } from "@langwatch/api/trpc";
import { describe, expect, it, vi } from "vitest";

import { createAuthzTestApp } from "../../app/__tests__/authz.fixture.ts";
import { authzTrpc, authzTrpcTransport } from "../authz.trpc.ts";

const USER_ID = "user_1";
const PROJECT_ID = "project_1";
const ORGANIZATION_ID = "organization_1";
const PROJECT_SCOPE: AuthzScopeRef = { type: "project", id: PROJECT_ID } as AuthzScopeRef;

type Procedure = (input: unknown) => Promise<unknown>;

/** The one procedure the declaration names, over a stated application. */
function harness(
  overrides: {
    tryResolveScope?: AuthzService["tryResolveScope"];
    effectivePermissions?: AuthzService["effectivePermissions"];
  } = {},
) {
  const tryResolveScope = vi.fn(overrides.tryResolveScope ?? (async () => PROJECT_SCOPE));
  const effectivePermissions = vi.fn(
    overrides.effectivePermissions ?? (async () => ["project:view" as const]),
  );
  const app = createAuthzTestApp({ permissions: { tryResolveScope, effectivePermissions } });

  const procedures: Record<string, Procedure> = {};
  const accesses: string[] = [];
  const runtime: TrpcProcedureFactory<object> = {
    procedure: ({ procedure, member, access, handle }) => {
      const invoke = handle as (args: TrpcContractHandlerArguments<unknown, AuthzApi>) => unknown;

      accesses.push(access.kind);
      procedures[procedure.split(".")[1]!] = async (input: unknown) =>
        invoke({
          app,
          input: member.input.parse(input),
          actor: { type: "user", id: USER_ID },
          scope: null,
          signal: undefined,
        });

      return {};
    },
    router: (record) => record,
  };

  authzTrpcTransport.router(runtime, () => app);

  return { tryResolveScope, effectivePermissions, procedures, accesses };
}

describe("the application's AuthZ tRPC adapter", () => {
  describe("when a procedure resolves effective permissions", () => {
    /** @scenario "Application tRPC remains a separate adapter" */
    it("delegates once to the composed contract service", async () => {
      const { procedures, tryResolveScope, effectivePermissions } = harness();

      const answer = await procedures.effectivePermissions!({ projectId: PROJECT_ID });

      expect(tryResolveScope).toHaveBeenCalledTimes(1);
      expect(effectivePermissions).toHaveBeenCalledTimes(1);
      expect(effectivePermissions).toHaveBeenCalledWith({
        principal: { type: "user", id: USER_ID },
        scope: PROJECT_SCOPE,
      });
      expect(answer).toEqual({
        scope: { type: "project", id: PROJECT_ID },
        permissions: ["project:view"],
      });
    });

    /**
     * The narrower id decides the scope, and it is the application that
     * decides it: the adapter forwards the input it parsed and nothing else.
     */
    /** @scenario "Application tRPC remains a separate adapter" */
    it("forwards the caller's input without deciding the scope itself", async () => {
      const { procedures, tryResolveScope } = harness();

      await procedures.effectivePermissions!({
        projectId: PROJECT_ID,
        organizationId: ORGANIZATION_ID,
      });

      expect(tryResolveScope).toHaveBeenCalledWith({
        projectId: PROJECT_ID,
        organizationId: undefined,
      });
    });

    /** @scenario "Application tRPC remains a separate adapter" */
    it("answers the empty set for a scope that does not resolve", async () => {
      const { procedures, effectivePermissions } = harness({ tryResolveScope: async () => null });

      const answer = await procedures.effectivePermissions!({ projectId: "project_missing" });

      expect(answer).toEqual({ scope: null, permissions: [] });
      expect(effectivePermissions).not.toHaveBeenCalled();
    });
  });

  describe("given the mounted router", () => {
    /** @scenario "Application tRPC remains a separate adapter" */
    it("exposes only the read the surface declares", () => {
      const { procedures } = harness();

      expect(Object.keys(authzTrpc.members)).toEqual(["effectivePermissions"]);
      expect(Object.keys(procedures)).toEqual(["effectivePermissions"]);
    });

    /**
     * Membership is the whole requirement, so the declaration proves standing
     * itself rather than naming a permission the caller must already hold.
     */
    /** @scenario "Application tRPC remains a separate adapter" */
    it("declares the read service-authorized", () => {
      const { accesses } = harness();

      expect(accesses).toEqual(["service-authorized"]);
    });
  });
});
