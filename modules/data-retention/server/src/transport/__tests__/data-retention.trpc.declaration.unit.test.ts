/**
 * The `dataRetention.*` wire, pinned: every procedure name, its kind, and the
 * access the server binds to it. A rename here is a cache-key change in every
 * browser that calls it, and a loosened access decision is a widened surface.
 */

import type { AuthzPermission } from "@langwatch/authz-contract";
import type { TrpcProcedureFactory } from "@langwatch/api/trpc";
import { dataRetentionTrpc } from "@langwatch/data-retention-contract";
import { describe, expect, it } from "vitest";

import { dataRetentionTrpcTransport } from "../data-retention.trpc.ts";

type DeclaredAccess = AuthzPermission | { kind: string; enforces?: Record<string, string> };

/** Mounts the declaration and records the access each procedure asked for. */
function declaredAccess(): DeclaredAccess[] {
  const declared: DeclaredAccess[] = [];

  const runtime: TrpcProcedureFactory<object> = {
    procedure: ({ access }) => {
      declared.push(access.kind === "permission" ? access.permission : access);

      return {};
    },
    router: (record) => record,
  };

  dataRetentionTrpcTransport.router(runtime, () => {
    throw new Error("the wire table never resolves an application");
  });

  return declared;
}

function kindOf(access: DeclaredAccess): string {
  return typeof access === "string" ? `permission:${access}` : access.kind;
}

describe("the data retention tRPC declaration", () => {
  describe("given the contract and the server it is bound to", () => {
    it("keeps the wire names, kinds and access decisions", () => {
      const access = declaredAccess();
      const table = Object.entries(dataRetentionTrpc.members).map(([name, member], index) => [
        name,
        member.kind,
        kindOf(access[index]!),
      ]);

      expect(table).toEqual([
        ["getRules", "query", "permission:project:view"],
        ["setForScope", "mutation", "service-authorized"],
        ["previewScopeRemoval", "query", "service-authorized"],
        ["removeForScope", "mutation", "service-authorized"],
        ["triggerRetroactiveUpdate", "mutation", "permission:project:update"],
        ["getMutationProgress", "query", "permission:traces:view"],
        ["killMutation", "mutation", "permission:project:update"],
        ["getScopeStorageUsage", "query", "permission:traces:view"],
      ]);
    });

    it("records that the scope-targeted procedures do not act on the project id they carry", () => {
      const scopeTargeted = declaredAccess().filter((access) => typeof access !== "string");

      expect(scopeTargeted).toHaveLength(3);
      for (const access of scopeTargeted) {
        expect(Object.keys(access.enforces ?? {})).toEqual(["projectId"]);
      }
    });
  });
});
