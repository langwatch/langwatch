/**
 * @vitest-environment node
 * Deactivation and an address change end credentials: user writes first, auth revokes after.
 */
import type { AuthApi } from "@langwatch/auth-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import {
  UserLastPlatformOperatorError,
  UserNotFoundError,
  type UserApi,
  type UserProfile,
} from "@langwatch/user-contract";
import { describe, expect, it } from "vitest";

import { AccountLifecycleService } from "../account-lifecycle.service.ts";

const AT = new Date("2026-10-08T09:00:00.000Z");

function profile(overrides: Partial<UserProfile> = {}): UserProfile {
  return {
    id: "user-1",
    name: "Ada",
    email: "ada@example.com",
    emailVerified: true,
    image: null,
    pendingSsoSetup: false,
    createdAt: AT,
    updatedAt: AT,
    lastLoginAt: null,
    deactivatedAt: null,
    ...overrides,
  };
}

/** Records every step in order; `refuse` and `failFact` stand in for user's own refusals. */
function setup({
  operators = [],
  refuse,
  failFact = false,
  stored = profile(),
}: {
  operators?: string[];
  refuse?: Error;
  failFact?: boolean;
  stored?: UserProfile | null;
} = {}) {
  const steps: unknown[][] = [];
  const users = createApiFixture<UserApi>({
    findById: async ({ id }) => (stored && stored.id === id ? stored : null),
    isOperator: async ({ userId }) => operators.includes(userId),
    deactivate: async (input) => {
      if (refuse) throw refuse;
      steps.push(["user.deactivate", input]);
      return profile({ id: input.id, deactivatedAt: AT });
    },
    recordDeactivated: async (input) => {
      if (failFact) throw new Error("event store unavailable");
      steps.push(["user.recordDeactivated", input]);
    },
    updateEmail: async ({ id, email }) => {
      if (!stored || stored.id !== id) throw new UserNotFoundError(id);
      steps.push(["user.updateEmail", id, email]);
      return profile({ id, email: email.trim().toLowerCase() });
    },
  });
  const credentials = createApiFixture<AuthApi>({
    revokeAllBrowserSessions: async ({ userId }) => {
      steps.push(["auth.revokeAllBrowserSessions", userId]);
    },
    revokeCliTokens: async ({ userId }) => {
      steps.push(["auth.revokeCliTokens", userId]);
      return { revokedCount: 1 };
    },
  });

  return { steps, service: AccountLifecycleService.create({ users, credentials }) };
}

const SYSTEM = { type: "system", id: null } as const;

describe("AccountLifecycleService", () => {
  describe("when an active account is deactivated", () => {
    /** @scenario "Deactivating an account ends every session family after the write" */
    /** @scenario "userService.deactivate also revokes CLI tokens" */
    it("writes, revokes browser sessions, revokes CLI tokens, then records the fact", async () => {
      const { steps, service } = setup();

      await service.deactivate({ id: "user-1", actor: SYSTEM });

      expect(steps).toEqual([
        ["user.deactivate", { id: "user-1", actor: SYSTEM }],
        ["auth.revokeAllBrowserSessions", "user-1"],
        ["auth.revokeCliTokens", "user-1"],
        ["user.recordDeactivated", { id: "user-1", actor: SYSTEM }],
      ]);
    });
  });

  describe("when user refuses the write as the last active operator", () => {
    /** @scenario "A refused deactivation revokes nothing" */
    it("refuses with user_last_platform_operator and revokes and records nothing", async () => {
      const { steps, service } = setup({ refuse: new UserLastPlatformOperatorError("user-1") });

      await expect(service.deactivate({ id: "user-1", actor: SYSTEM })).rejects.toMatchObject({
        code: "user_last_platform_operator",
      });
      expect(steps).toEqual([]);
    });
  });

  describe("when user's fact cannot be sent", () => {
    /** @scenario "Deactivation ends access even when user's fact cannot be sent" */
    it("fails, with the browser sessions and CLI tokens already revoked", async () => {
      const { steps, service } = setup({ failFact: true });

      await expect(service.deactivate({ id: "user-1", actor: SYSTEM })).rejects.toThrow(
        "event store unavailable",
      );
      expect(steps.map(([step]) => step)).toEqual([
        "user.deactivate",
        "auth.revokeAllBrowserSessions",
        "auth.revokeCliTokens",
      ]);
    });
  });

  describe("when somebody deactivates another account", () => {
    /** @scenario "Deactivating somebody else's account needs the platform-operator grant" */
    it("refuses a caller who is no operator, and lets an operator through as the actor", async () => {
      const { steps, service } = setup({ operators: ["op-1"] });

      await expect(
        service.deactivateAsCaller({
          userId: "user-1",
          caller: { id: "someone", operatorId: "someone", impersonated: false },
        }),
      ).rejects.toMatchObject({ code: "forbidden" });
      expect(steps).toEqual([]);

      await service.deactivateAsCaller({
        userId: "user-1",
        caller: { id: "op-1", operatorId: "op-1", impersonated: false },
      });
      expect(steps[0]).toEqual([
        "user.deactivate",
        { id: "user-1", actor: { type: "user", id: "op-1" } },
      ]);
    });

    /** @scenario "An impersonated caller cannot deactivate another account" */
    it("refuses an operator impersonating a customer, and writes and revokes nothing", async () => {
      const { steps, service } = setup({ operators: ["op-1"] });

      await expect(
        service.deactivateAsCaller({
          userId: "user-1",
          caller: { id: "customer", operatorId: "op-1", impersonated: true },
        }),
      ).rejects.toMatchObject({ code: "forbidden" });
      expect(steps).toEqual([]);
    });
  });

  describe("when an account's address changes", () => {
    /** @scenario "Changing an email refreshes authenticated identity" */
    it("stores the address through user, then revokes every browser session", async () => {
      const { steps, service } = setup();

      await service.changeEmail({ id: "user-1", email: "Ada.New@Example.com" });

      expect(steps).toEqual([
        ["user.updateEmail", "user-1", "Ada.New@Example.com"],
        ["auth.revokeAllBrowserSessions", "user-1"],
      ]);
    });

    /** @scenario "Saving the same address signs nobody out" */
    it("revokes nothing when the address is the one already held", async () => {
      const { steps, service } = setup();

      await service.changeEmail({ id: "user-1", email: "ADA@example.com" });

      expect(steps).toEqual([["user.updateEmail", "user-1", "ADA@example.com"]]);
    });

    /** @scenario "An address change for an unknown account revokes nothing" */
    it("refuses with user_not_found and revokes nothing", async () => {
      const { steps, service } = setup({ stored: null });

      await expect(
        service.changeEmail({ id: "user-1", email: "a@example.com" }),
      ).rejects.toMatchObject({ code: "user_not_found" });
      expect(steps).toEqual([]);
    });
  });
});
