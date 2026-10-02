/**
 * @vitest-environment node
 * The audit trail and the group list and create ask for Enterprise, naming the feature.
 * @see specs/features/enterprise-feature-guards.feature
 * @see enterprise/modules/scim/specs/scim-group-mapping.feature
 */
import type { EntitlementGate } from "@langwatch/api/access";
import type { TrpcProcedureFactory } from "@langwatch/api/trpc";
import { describe, expect, it } from "vitest";

import { groupTrpcTransport } from "../group.trpc.ts";
import { organizationTrpcTransport } from "../organization.trpc.ts";

const notCalled = (): never => {
  throw new Error("the application is not reached while declaring");
};

/** Each procedure's declared plan question, by its name within the namespace. */
function gates(
  mount: (runtime: TrpcProcedureFactory<object>) => unknown,
): Map<string, EntitlementGate | undefined> {
  const declared = new Map<string, EntitlementGate | undefined>();
  mount({
    procedure: ({ procedure, entitlement }) => {
      declared.set(procedure.split(".")[1] ?? procedure, entitlement);
      return {};
    },
    router: (record) => record,
  });
  return declared;
}

const organization = gates((runtime) => organizationTrpcTransport.router(runtime, notCalled));
const groups = gates((runtime) => groupTrpcTransport.router(runtime, notCalled));

describe("given an organization below Enterprise", () => {
  /** @scenario "Non-enterprise org cannot access audit logs" */
  it("asks for Enterprise, naming AUDIT_LOGS, before the audit trail is read", () => {
    expect(organization.get("getAuditLogs")).toEqual({
      entitlement: "enterprise",
      feature: "AUDIT_LOGS",
    });
  });

  /** @scenario "Non-enterprise org cannot access group management endpoints" */
  it("asks for Enterprise, naming SCIM, before groups are listed or created", () => {
    for (const name of ["listAll", "create"]) {
      expect(groups.get(name)).toEqual({ entitlement: "enterprise", feature: "SCIM" });
    }
  });

  it("asks for Enterprise, naming RBAC, only when a group write grants a custom role", () => {
    const custom = { role: "CUSTOM", customRoleId: "role-1", scopeType: "ORGANIZATION" };
    const builtIn = { role: "MEMBER", scopeType: "ORGANIZATION" };

    for (const [name, input] of [
      ["addGrant", { organizationId: "org-1", groupId: "g-1", ...custom }],
      [
        "applyEdits",
        { organizationId: "org-1", groupId: "g-1", grantsToCreate: [builtIn, custom] },
      ],
    ] as const) {
      const gate = groups.get(name);
      expect(gate).toMatchObject({ entitlement: "enterprise", feature: "RBAC" });
      expect(gate?.when?.(input)).toBe(true);
    }
    expect(
      groups.get("addGrant")?.when?.({ organizationId: "org-1", groupId: "g-1", ...builtIn }),
    ).toBe(false);
    expect(groups.get("applyEdits")?.when?.({ grantsToCreate: [builtIn] })).toBe(false);
  });

  it("leaves the rest of the group namespace to its permission alone", () => {
    const gated = ["listAll", "create", "addGrant", "applyEdits"];
    const ungated = [...groups].filter(([name]) => !gated.includes(name));
    expect(ungated.length).toBeGreaterThan(0);
    expect(ungated.filter(([, gate]) => gate !== undefined)).toEqual([]);
  });
});
