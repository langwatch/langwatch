/**
 * @vitest-environment node
 * The `user.*` procedures, their kinds and their access declarations, pinned.
 * The names are the browser's cache keys, so a rename here is a wire change.
 * @see modules/user/specs/user.feature
 */
import { userTrpc } from "@langwatch/user-contract";
import { describe, expect, it } from "vitest";

import { userTrpcTransport } from "../user.trpc.ts";

describe("the user tRPC surface", () => {
  describe("given the declaration a process mounts", () => {
    it("keeps the namespace the browser calls", () => {
      expect(userTrpcTransport.namespace).toBe("user");
      expect(userTrpcTransport.protocol).toBe("trpc");
    });

    it("declares every procedure the account and /me screens call", () => {
      expect(Object.keys(userTrpc.members).sort()).toEqual([
        "changePassword",
        "deactivate",
        "dismissPasskeyNudge",
        "dismissTraceExplorerTour",
        "getAccountInfo",
        "getLinkedAccounts",
        "getSsoStatus",
        "getTraceExplorerTourPreference",
        "hasPassword",
        "homePagePickerState",
        "isAdmin",
        "passkeyNudge",
        "personalBudget",
        "personalContext",
        "reactivate",
        "register",
        "removeAvatar",
        "requestBudgetIncrease",
        "setAvatar",
        "setLastHomePath",
        "setPassword",
        "unlinkAccount",
        "updateLastLogin",
      ]);
    });

    it("reads with queries and writes with mutations, as the client's cache expects", () => {
      const kinds = Object.fromEntries(
        Object.entries(userTrpc.members).map(([name, member]) => [name, member.kind]),
      );

      expect(kinds).toMatchObject({
        getAccountInfo: "query",
        getLinkedAccounts: "query",
        getSsoStatus: "query",
        getTraceExplorerTourPreference: "query",
        hasPassword: "query",
        homePagePickerState: "query",
        isAdmin: "query",
        passkeyNudge: "query",
        personalBudget: "query",
        personalContext: "query",
        changePassword: "mutation",
        deactivate: "mutation",
        register: "mutation",
        setAvatar: "mutation",
        setPassword: "mutation",
        unlinkAccount: "mutation",
      });
    });

    it("acknowledges the sign-in stamp without a body, as it always has", () => {
      expect(userTrpc.members.updateLastLogin?.output).toBeUndefined();
    });
  });
});
