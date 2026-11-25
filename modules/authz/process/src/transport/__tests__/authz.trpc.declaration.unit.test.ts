/**
 * Who may call each grant procedure: directory reads at `members:view`, writes at
 * `organization:manage`. Specs: modules/authz/specs/directory-read-for-every-role.feature
 * and specs/licensing/billing-role.feature
 */
import type { TrpcProcedureFactory } from "@langwatch/api/trpc";
import { describe, expect, it } from "vitest";

import { authzTrpcTransport } from "../authz.trpc.ts";

function claimsOf(): Record<string, string | undefined> {
  const claims: Record<string, string | undefined> = {};
  const runtime: TrpcProcedureFactory<object> = {
    procedure: ({ procedure, access }) => {
      const declared = access as { kind: string; permission?: string };
      claims[procedure.slice(procedure.indexOf(".") + 1)] =
        declared.kind === "permission" ? declared.permission : declared.kind;
      return {};
    },
    router: (record) => record,
  };
  authzTrpcTransport.router(runtime, () => {
    throw new Error("the wire table never resolves an application");
  });
  return claims;
}

describe("the authz grant procedures", () => {
  const claims = claimsOf();

  /** @scenario "Directory reads declare members:view and writes stay at organization:manage" */
  it("reads the directory at members:view and writes at organization:manage", () => {
    for (const read of ["listManagedGrants", "listMemberGrants"]) {
      expect(claims[read]).toBe("members:view");
    }
    for (const write of ["createGrant", "changeGrantRole", "revokeGrant", "applyMemberGrants"]) {
      expect(claims[write]).toBe("organization:manage");
    }
  });

  /** @scenario "Only an administrator can change Billing" */
  it("changes Billing at organization:manage and lists its holders at members:view", () => {
    expect(claims.setMemberBillingRole).toBe("organization:manage");
    expect(claims.listBillingMembers).toBe("members:view");
  });
});
