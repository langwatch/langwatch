/**
 * @vitest-environment node
 * The `user.*` procedures, their kinds and their access declarations, pinned.
 * The names are the browser's cache keys, so a rename here is a wire change.
 * @see modules/user/specs/user.feature
 */
import {
  cliBootstrapResultSchema,
  governanceBudgetOverviewForUserSchema,
  personalUsageRollupSchema,
} from "@langwatch/enterprise-governance-contract";
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
      expect(Object.keys(userTrpc.members).toSorted()).toEqual([
        "browserSessions",
        "budgetOverview",
        "changePassword",
        "cliBootstrap",
        "deactivate",
        "dismissSecureAccountNudge",
        "dismissTraceExplorerTour",
        "endBrowserSession",
        "getAccountInfo",
        "getLinkedAccounts",
        "getSsoStatus",
        "getTraceExplorerTourPreference",
        "hasPassword",
        "homePagePickerState",
        "isAdmin",
        "personalBudget",
        "personalContext",
        "personalUsage",
        "reactivate",
        "register",
        "removeAvatar",
        "requestBudgetIncrease",
        "secureAccountNudge",
        "setAvatar",
        "setLastHomePath",
        "setPassword",
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
        browserSessions: "query",
        endBrowserSession: "mutation",
        getAccountInfo: "query",
        getLinkedAccounts: "query",
        getSsoStatus: "query",
        getTraceExplorerTourPreference: "query",
        hasPassword: "query",
        homePagePickerState: "query",
        isAdmin: "query",
        secureAccountNudge: "query",
        dismissSecureAccountNudge: "mutation",
        updateName: "mutation",
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

    it("answers main's governance reads as queries, in governance's own wire shapes", () => {
      const { personalUsage, budgetOverview, cliBootstrap } = userTrpc.members;

      expect([personalUsage?.kind, budgetOverview?.kind, cliBootstrap?.kind]).toEqual([
        "query",
        "query",
        "query",
      ]);
      expect(personalUsage?.output).toBe(personalUsageRollupSchema);
      expect(budgetOverview?.output).toBe(governanceBudgetOverviewForUserSchema);
      expect(cliBootstrap?.output).toBe(cliBootstrapResultSchema);
      expect(
        personalUsage?.input.validate({
          organizationId: "org-1",
          windowStartMs: 1,
          windowEndMs: 2,
        }),
      ).toBe(true);
      expect(
        budgetOverview?.input.validate({ organizationId: "org-1", includeTopModels: true }),
      ).toBe(true);
      expect(cliBootstrap?.input.validate({ organizationId: "org-1" })).toBe(true);
    });

    it("acknowledges the sign-in stamp without a body, as it always has", () => {
      expect(userTrpc.members.updateLastLogin?.output).toBeUndefined();
    });
  });
});
