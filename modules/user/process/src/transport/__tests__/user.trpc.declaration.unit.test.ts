/**
 * @vitest-environment node
 * The `user.*` procedures, their kinds and their access declarations, pinned.
 * The names are the browser's cache keys, so a rename here is a wire change.
 * @see modules/user/specs/user.feature
 */
import type { TrpcAccess, TrpcProcedureFactory } from "@langwatch/api/trpc";
import { userTrpc } from "@langwatch/user-contract";
import { describe, expect, it } from "vitest";

import { userTrpcTransport } from "../user.trpc.ts";

/** The access each procedure declared, by name, building nothing. */
function accessByProcedure(): Record<string, TrpcAccess> {
  const declared: TrpcAccess[] = [];
  const runtime: TrpcProcedureFactory<object> = {
    procedure: ({ access }) => {
      declared.push(access);
      return {};
    },
    router: (record) => record,
  };
  userTrpcTransport.router(runtime, () => {
    throw new Error("This test mounts but never handles a request");
  });
  return Object.fromEntries(Object.keys(userTrpc.members).map((name, i) => [name, declared[i]!]));
}

describe("the user tRPC surface", () => {
  describe("given the declaration a process mounts", () => {
    it("keeps the namespace the browser calls", () => {
      expect(userTrpcTransport.namespace).toBe("user");
      expect(userTrpcTransport.protocol).toBe("trpc");
    });

    it("declares every procedure the account and /me screens call", () => {
      expect(Object.keys(userTrpc.members).toSorted()).toEqual([
        "dismissSecureAccountNudge",
        "dismissTraceExplorerTour",
        "getAccountInfo",
        "getAvatarUrl",
        "getLinkedAccounts",
        "getNotificationPreference",
        "getSsoStatus",
        "getTraceExplorerTourPreference",
        "hasPassword",
        "homePagePickerState",
        "isAdmin",
        "reactivate",
        "removeAvatar",
        "requestBudgetIncrease",
        "secureAccountNudge",
        "setAvatar",
        "setLastHomePath",
        "setNotificationPreference",
        "unlinkAccount",
        "updateLastLogin",
        "updateName",
      ]);
    });

    it("reads with queries and writes with mutations, as the client's cache expects", () => {
      const kinds = Object.fromEntries(
        Object.entries(userTrpc.members).map(([name, member]) => [name, member.kind]),
      );

      expect(kinds).toMatchObject({
        getAccountInfo: "query",
        getAvatarUrl: "query",
        getLinkedAccounts: "query",
        getSsoStatus: "query",
        getTraceExplorerTourPreference: "query",
        getNotificationPreference: "query",
        setNotificationPreference: "mutation",
        hasPassword: "query",
        homePagePickerState: "query",
        isAdmin: "query",
        secureAccountNudge: "query",
        dismissSecureAccountNudge: "mutation",
        updateName: "mutation",
        setAvatar: "mutation",
        unlinkAccount: "mutation",
      });
    });

    it("lets the avatar URL read take the project id its address carries", () => {
      expect(accessByProcedure().getAvatarUrl).toMatchObject({
        kind: "no-permission",
        allow: { projectId: expect.any(String) },
      });
    });

    it("acknowledges the sign-in stamp without a body, as it always has", () => {
      expect(userTrpc.members.updateLastLogin?.output).toBeUndefined();
    });
  });
});
