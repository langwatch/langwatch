import type { TrpcProcedureFactory, TrpcRouterMount } from "@langwatch/api/trpc";
/**
 * The role tRPC wire, pinned: every procedure name and the access each declares.
 * A rename is a cache-key change in every browser, and a widened decision is a
 * privilege-escalation surface.
 */
import type { AuthzPermission } from "@langwatch/authorization";
import { roleTrpc } from "@langwatch/role-contract";
import { describe, expect, it } from "vitest";

import { roleTrpcTransport } from "../role.trpc.ts";

type Declared = Record<string, readonly string[]>;

/** The permissions a declaration claims, whichever declared shape it holds. */
function claimedPermissions(access: { kind: string } & Record<string, unknown>): string[] {
  if (access.kind === "permission") return [access.permission as AuthzPermission];

  return "permissions" in access ? [...(access.permissions as readonly string[])] : [];
}

/** Mounts a declaration and records the permissions each procedure claims. */
function claimsOf(declaration: { router: TrpcRouterMount<never, never> }): Declared {
  const claims: Record<string, readonly string[]> = {};

  const runtime: TrpcProcedureFactory<object> = {
    procedure: ({ procedure, access }) => {
      const name = procedure.slice(procedure.indexOf(".") + 1);
      claims[name] = claimedPermissions(access);

      return {};
    },
    router: (record) => record,
  };

  declaration.router(runtime, () => {
    throw new Error("the wire table never resolves an application");
  });

  return claims;
}

describe("given the role transport declared by the feature", () => {
  describe("when a process mounts it on its own tRPC root", () => {
    /** @scenario "The role transport moves without changing who may call it" */
    it("publishes the same procedure names, each with its access decision declared", () => {
      const claims = claimsOf(roleTrpcTransport);

      expect(Object.keys(claims).toSorted()).toEqual(
        [
          "assignToUser",
          "create",
          "delete",
          "getAll",
          "getById",
          "removeFromUser",
          "update",
        ].toSorted(),
      );
      expect(Object.keys(claims).toSorted()).toEqual(Object.keys(roleTrpc.members).toSorted());

      for (const [name, claimed] of Object.entries(claims)) {
        expect(claimed).toContain(name === "getById" ? "organization:view" : "organization:manage");
      }
    });
  });
});
