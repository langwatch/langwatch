/**
 * @vitest-environment node
 * The joining setting is declared behind the authority that gates managing the organization.
 * @see specs/identity/domain-auto-join.feature
 */
import type { TrpcProcedureFactory } from "@langwatch/api/trpc";
import { describe, expect, it } from "vitest";

import { joinRequestTrpcTransport } from "../join-request.trpc.ts";

const notCalled = (): never => {
  throw new Error("the application is not reached while declaring");
};

/** The access each procedure declared, by its name within the namespace. */
function accessOf(): Map<string, { kind: string; permission?: string }> {
  const declared = new Map<string, { kind: string; permission?: string }>();
  const runtime: TrpcProcedureFactory<object> = {
    procedure: ({ procedure, access }) => {
      declared.set(procedure.split(".")[1] ?? procedure, access);
      return {};
    },
    router: (record) => record,
  };
  joinRequestTrpcTransport.router(runtime, notCalled);
  return declared;
}

describe("given the joining setting's procedures", () => {
  describe("when the declaration is mounted", () => {
    /** @scenario "Changing the setting needs the authority that gates managing the organization" */
    it("asks for organization:manage before the change and before the read", () => {
      const access = accessOf();

      expect(access.get("setJoining")).toMatchObject({
        kind: "permission",
        permission: "organization:manage",
      });
      expect(access.get("joining")).toMatchObject({
        kind: "permission",
        permission: "organization:manage",
      });
    });
  });
});
