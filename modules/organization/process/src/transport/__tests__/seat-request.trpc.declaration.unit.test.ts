/**
 * @vitest-environment node
 * Asking for a full seat needs only a membership; approving with a seat charges the plan.
 * @see ../../../../specs/seat-requests.feature
 */
import type { TrpcProcedureFactory } from "@langwatch/api/trpc";
import { describe, expect, it } from "vitest";

import { seatRequestTrpcTransport } from "../seat-request.trpc.ts";

function accessOf(): Record<string, unknown> {
  const access: Record<string, unknown> = {};
  const runtime: TrpcProcedureFactory<object> = {
    procedure: ({ procedure, access: declared }) => {
      access[procedure.slice(procedure.indexOf(".") + 1)] = declared;
      return {};
    },
    router: (record) => record,
  };
  seatRequestTrpcTransport.router(runtime, () => {
    throw new Error("the wire table never resolves an application");
  });
  return access;
}

describe("the seat request procedures", () => {
  /** @scenario "Asking needs only a membership in the organization" */
  it("ask members:view to request access and to read one's own request", () => {
    const access = accessOf();

    for (const name of ["requestAccess", "myAccessRequest"]) {
      const declared = JSON.stringify(access[name]);
      expect(declared).toContain("members:view");
      expect(declared).not.toContain("seatRequests");
    }
  });

  it("ask seatRequests:manage and subscription:manage where approving charges a seat", () => {
    const access = accessOf();

    for (const name of ["approveWithSeat", "completeSeatApproval"]) {
      const declared = JSON.stringify(access[name]);
      expect(declared).toContain("seatRequests:manage");
      expect(declared).toContain("subscription:manage");
    }
  });
});
