/**
 * @vitest-environment node
 * A role change that buys a seat charges the plan, so the door asks both permissions.
 * @see ../../../../../../specs/licensing/role-change-seat.feature
 */
import type { TrpcProcedureFactory } from "@langwatch/api/trpc";
import { describe, expect, it } from "vitest";

import { organizationTrpcTransport } from "../organization.trpc.ts";

function accessOf(): Record<string, unknown> {
  const access: Record<string, unknown> = {};
  const runtime: TrpcProcedureFactory<object> = {
    procedure: ({ procedure, access: declared }) => {
      access[procedure.slice(procedure.indexOf(".") + 1)] = declared;
      return {};
    },
    router: (record) => record,
  };
  organizationTrpcTransport.router(runtime, () => {
    throw new Error("the wire table never resolves an application");
  });
  return access;
}

describe("the seat role change procedures", () => {
  /** @scenario "Buying a seat with a role change needs both member and plan management" */
  it("ask organization:manage and subscription:manage where a seat is charged or applied", () => {
    const access = accessOf();

    for (const name of [
      "changeMemberRoleWithSeat",
      "completeSeatRoleChange",
      "recordBlockedRoleChange",
    ]) {
      const declared = JSON.stringify(access[name]);
      expect(declared).toContain("organization:manage");
      expect(declared).toContain("subscription:manage");
    }
    expect(JSON.stringify(access.pendingSeatRoleChange)).toContain("organization:manage");
  });
});
