/**
 * The `dataRetention.*` wire, pinned: every procedure name, kind and access. A rename is a
 * cache-key change in every browser; a loosened access decision is a widened surface.
 * Spec: modules/data-retention/specs/data-retention-scope-writes.feature
 */

import type { TrpcProcedureFactory } from "@langwatch/api/trpc";
import type { AuthzPermission } from "@langwatch/authorization";
import { dataRetentionTrpc } from "@langwatch/data-retention-contract";
import { describe, expect, it } from "vitest";

import { dataRetentionTrpcTransport } from "../data-retention.trpc.ts";

type DeclaredAccess = AuthzPermission | { kind: string };

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
        ["setForScope", "mutation", "permission-by-input"],
        ["previewScopeRemoval", "query", "permission-by-input"],
        ["removeForScope", "mutation", "permission-by-input"],
        ["triggerRetroactiveUpdate", "mutation", "permission:project:update"],
        ["getMutationProgress", "query", "permission:traces:view"],
        ["killMutation", "mutation", "permission:project:update"],
        ["getScopeStorageUsage", "query", "permission:traces:view"],
      ]);
    });

    /** @scenario "Each scope procedure declares the target's permission at the door" */
    it("asks each scope write's permission on its target, chosen by the scope type", () => {
      const scopeWrites = declaredAccess().filter((access) => typeof access !== "string");

      expect(scopeWrites).toHaveLength(3);
      for (const access of scopeWrites) {
        expect(access).toMatchObject({
          kind: "permission-by-input",
          field: "scope.scopeType",
          map: {
            ORGANIZATION: { permission: "organization:manage", field: "scope.scopeId" },
            TEAM: { permission: "team:manage", field: "scope.scopeId" },
            PROJECT: { permission: "project:update", field: "scope.scopeId" },
          },
        });
      }
    });
  });
});
