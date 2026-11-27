/**
 * The `dataPrivacy.*` wire, pinned: every procedure name, kind and access. A loosened access
 * decision is a widened surface; accepting the PII redaction model's price is an organization
 * admin's alone. Spec: modules/data-privacy/specs/pii-redaction-level-picker.feature
 */

import type { TrpcProcedureFactory } from "@langwatch/api/trpc";
import { dataPrivacyTrpc } from "@langwatch/data-privacy-contract";
import { describe, expect, it } from "vitest";

import { dataPrivacyTrpcTransport } from "../data-privacy.trpc.ts";

type DeclaredAccess = string | { kind: string };

/** Mounts the declaration and records the access each procedure asked for, by its name. */
function declaredAccess(): ReadonlyMap<string, DeclaredAccess> {
  const declared = new Map<string, DeclaredAccess>();

  const runtime: TrpcProcedureFactory<object> = {
    procedure: ({ procedure, access }) => {
      declared.set(procedure, access.kind === "permission" ? access.permission : access);

      return {};
    },
    router: (record) => record,
  };

  dataPrivacyTrpcTransport.router(runtime, () => {
    throw new Error("the wire table never resolves an application");
  });

  return declared;
}

function kindOf(access: DeclaredAccess | undefined): string {
  if (access === undefined) return "undeclared";
  return typeof access === "string" ? `permission:${access}` : access.kind;
}

describe("the data privacy tRPC declaration", () => {
  describe("given the contract and the server it is bound to", () => {
    /** @scenario "Only an organization admin can accept the price" */
    it("keeps the wire names, kinds and access decisions", () => {
      const access = declaredAccess();
      const table = Object.entries(dataPrivacyTrpc.members).map(([name, member]) => [
        name,
        member.kind,
        kindOf(access.get(`${dataPrivacyTrpc.namespace}.${name}`)),
      ]);

      expect(table).toEqual([
        ["getSnapshot", "query", "permission:project:view"],
        ["setForScope", "mutation", "service-authorized"],
        ["removeForScope", "mutation", "service-authorized"],
        ["acceptPiiRedactionModel", "mutation", "permission:organization:manage"],
      ]);
    });
  });
});
