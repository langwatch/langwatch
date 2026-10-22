/**
 * @vitest-environment node
 * What the braid dialog's reads declare at the door (ADR-183 §2, §7). The runtime asks the
 * declaration before the handler runs; this reads what each procedure declares.
 */
import type { TrpcProcedureFactory } from "@langwatch/api/trpc";
import { describe, expect, it } from "vitest";

import { authzTrpcTransport } from "../authz.trpc.ts";

const notCalled = (): never => {
  throw new Error("the application is not reached while declaring");
};

function declaredAccess(): Map<string, unknown> {
  const declared = new Map<string, unknown>();
  const runtime: TrpcProcedureFactory<object> = {
    procedure: ({ procedure, access }) => {
      declared.set(procedure.split(".")[1] ?? procedure, access);
      return {};
    },
    router: (record) => record,
  };
  authzTrpcTransport.router(runtime, notCalled);
  return declared;
}

describe("the braid dialog's reads", () => {
  describe("when the dialog asks how many people will see the spans", () => {
    /** @scenario "Only someone who can read the reader's traces may ask how many people will see them" */
    it("declares traces:view at the project it names", () => {
      expect(declaredAccess().get("countProjectTraceViewers")).toMatchObject({
        kind: "permission",
        permission: "traces:view",
        via: "projectId",
      });
    });
  });
});
