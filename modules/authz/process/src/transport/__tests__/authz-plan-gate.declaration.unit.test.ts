/**
 * @vitest-environment node
 * The grant doors' declared plan questions. The runtime asks them after access and before the
 * handler (packages/api runtime.unit tests); this reads what each door declares.
 */
import type { EntitlementGate } from "@langwatch/api/access";
import type { TrpcProcedureFactory } from "@langwatch/api/trpc";
import { describe, expect, it } from "vitest";

import { authzGrantRest } from "../authz-grant.rest.ts";
import { authzRoleBindingRest } from "../authz-role-binding.rest.ts";
import { authzTrpcTransport } from "../authz.trpc.ts";

const notCalled = (): never => {
  throw new Error("the application is not reached while declaring");
};

function trpcGates(): Map<string, EntitlementGate | undefined> {
  const declared = new Map<string, EntitlementGate | undefined>();
  const runtime: TrpcProcedureFactory<object> = {
    procedure: ({ procedure, entitlement }) => {
      declared.set(procedure.split(".")[1] ?? procedure, entitlement);
      return {};
    },
    router: (record) => record,
  };
  authzTrpcTransport.router(runtime, notCalled);
  return declared;
}

/** Whether the declared gate asks the plan for this input: an absent gate never asks. */
function asks(gate: EntitlementGate | undefined, input: unknown): boolean {
  if (!gate) return false;
  return gate.when ? gate.when(input) : true;
}

const grantTo = (roleId: string) => ({
  organizationId: "org-1",
  grant: {
    principal: { type: "user", id: "user-2" },
    roleId,
    scope: { type: "team", id: "team-a" },
  },
});

describe("the grant REST families", () => {
  /** @scenario Both grant families answer 402 below Enterprise, naming the management API */
  it("ask for Enterprise on every route, naming MANAGEMENT_API", () => {
    const routes = [...authzGrantRest.router().routes, ...authzRoleBindingRest.router().routes];

    for (const route of routes) {
      expect(route.entitlement).toMatchObject({
        entitlement: "enterprise",
        feature: "MANAGEMENT_API",
      });
    }
  });
});

describe("the grant procedures the Roles & access page calls", () => {
  const gates = trpcGates();

  /** @scenario Assigning a custom role is refused below Enterprise on every grant door */
  it("ask for Enterprise, naming RBAC, whenever a write assigns a custom role", () => {
    for (const name of ["createGrant", "changeGrantRole", "applyMemberGrants"]) {
      expect(gates.get(name)).toMatchObject({ entitlement: "enterprise", feature: "RBAC" });
    }

    expect(asks(gates.get("createGrant"), grantTo("customrole_ops"))).toBe(true);
    expect(
      asks(gates.get("changeGrantRole"), {
        organizationId: "org-1",
        grantId: "g1",
        roleId: "customrole_ops",
      }),
    ).toBe(true);
    expect(
      asks(gates.get("applyMemberGrants"), {
        organizationId: "org-1",
        userId: "user-2",
        bindingIdsToDelete: [],
        bindingsToCreate: [
          { role: "MEMBER", scopeType: "TEAM", scopeId: "team-a" },
          { role: "CUSTOM", customRoleId: "customrole_ops", scopeType: "TEAM", scopeId: "team-a" },
        ],
      }),
    ).toBe(true);
  });

  /** @scenario Any plan grants and changes roles, with or without an end date */
  it("never ask the plan when only built-in roles are granted or changed", () => {
    expect(asks(gates.get("createGrant"), grantTo("member"))).toBe(false);
    expect(
      asks(gates.get("changeGrantRole"), {
        organizationId: "org-1",
        grantId: "g1",
        roleId: "viewer",
      }),
    ).toBe(false);
    expect(
      asks(gates.get("applyMemberGrants"), {
        organizationId: "org-1",
        userId: "user-2",
        bindingIdsToDelete: ["g1"],
        bindingsToCreate: [{ role: "VIEWER", scopeType: "TEAM", scopeId: "team-a" }],
      }),
    ).toBe(false);
    expect(gates.get("listGrants")).toBeUndefined();
  });
});
