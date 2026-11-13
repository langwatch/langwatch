/**
 * @vitest-environment node
 * The docs playground switch is a security policy of the organization's: only an administrator
 * reads or changes it, declared at the door. @see modules/api-key/specs/docs-session-keys.feature
 */
import type { TrpcProcedureFactory } from "@langwatch/api/trpc";
import { describe, expect, it } from "vitest";

import { organizationTrpcTransport } from "../organization.trpc.ts";

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
  organizationTrpcTransport.router(runtime, () => {
    throw new Error("the wire table never resolves an application");
  });
  return claims;
}

describe("the docs playground policy procedures", () => {
  /** @scenario "An organisation turns the playground session off" */
  it("reads and saves the switch at organization:manage", () => {
    const claims = claimsOf();

    expect(claims.getDocsPlaygroundPolicy).toBe("organization:manage");
    expect(claims.saveDocsPlaygroundPolicy).toBe("organization:manage");
  });
});
