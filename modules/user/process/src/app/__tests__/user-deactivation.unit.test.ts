/**
 * @vitest-environment node
 * Deactivation is three writes, not one: stopping at the durable flag would
 * leave a live session and a live command-line token belonging to somebody the
 * product says is gone. What this pins is that all three happen, in order, on every door.
 */
import {
  UserAccountAccessDeniedError,
  UserLastPlatformOperatorError,
  userLifecycleEventDataSchema,
} from "@langwatch/user-contract";
import { describe, expect, it, vi } from "vitest";

import type { UserLifecycleSenders } from "../../services/user-lifecycle-notice.service.ts";
import {
  createUserTestApp,
  createUserTestAuth,
  createUserTestAuthorization,
  createUserTestInfrastructure,
  createUserTestLifecycle,
} from "./user.fixture.ts";

const SELF = { id: "user_1", email: "person@example.test" };

async function account(app: ReturnType<typeof createUserTestApp>) {
  return app.createCredentialUser({
    name: "Person",
    email: SELF.email,
    passwordHash: "hashed:first",
  });
}

describe("user.deactivate", () => {
  describe("given an active user deactivating themselves", () => {
    /** @scenario "Deactivating a user invalidates every session family" */
    it("marks them deactivated, then revokes browser sessions, then revokes CLI tokens", async () => {
      const reached: string[] = [];
      const auth = createUserTestAuth();
      auth.revokeAllBrowserSessions.mockImplementation(async () => {
        reached.push("revokeAllBrowserSessions");
      });
      const members = createUserTestInfrastructure({
        cliCredentials: {
          revokeForUser: vi.fn(async () => {
            reached.push("revokeCliTokensForUser");
          }),
        },
      });
      const app = createUserTestApp({ members, dependencies: { auth } });
      const created = await account(app);

      await app.deactivateAccount({
        userId: created.id,
        caller: { id: created.id, operatorId: created.id, impersonated: false },
      });

      await expect(app.findById({ id: created.id })).resolves.toMatchObject({
        deactivatedAt: expect.any(Date),
      });
      expect(reached).toEqual(["revokeAllBrowserSessions", "revokeCliTokensForUser"]);
    });
  });

  describe("given somebody else's account and a caller who is no operator", () => {
    it("refuses, and writes nothing", async () => {
      const auth = createUserTestAuth();
      const app = createUserTestApp({ dependencies: { auth } });
      const created = await account(app);

      await expect(
        app.deactivateAccount({
          userId: created.id,
          caller: { id: "someone-else", operatorId: "someone-else", impersonated: false },
        }),
      ).rejects.toBeInstanceOf(UserAccountAccessDeniedError);
      expect(auth.revokeAllBrowserSessions).not.toHaveBeenCalled();
    });
  });

  describe("given somebody else's account and an operator", () => {
    it("deactivates it, because the platform-operator grant is the standing", async () => {
      const operators = new Set<string>();
      const app = createUserTestApp({
        dependencies: { authz: createUserTestAuthorization(operators) },
      });
      const created = await account(app);
      const operator = await app.createCredentialUser({
        name: "Op",
        email: "op@example.test",
        passwordHash: "hashed:first",
      });
      operators.add(operator.id);

      await app.deactivateAccount({
        userId: created.id,
        caller: { id: operator.id, operatorId: operator.id, impersonated: false },
      });

      await expect(app.findById({ id: created.id })).resolves.toMatchObject({
        deactivatedAt: expect.any(Date),
      });
    });
  });

  describe("given a platform operator impersonating a customer", () => {
    /** @scenario "An impersonated session cannot deactivate another account or reactivate any" */
    it("refuses deactivating another account and reactivating one, and changes neither", async () => {
      const operators = new Set<string>();
      const app = createUserTestApp({
        dependencies: { authz: createUserTestAuthorization(operators) },
      });
      const customer = await account(app);
      const op = await app.createCredentialUser({
        name: "Op",
        email: "op@example.test",
        passwordHash: "hashed:first",
      });
      const other = await app.createCredentialUser({
        name: "B",
        email: "b@example.test",
        passwordHash: "hashed:first",
      });
      const gone = await app.createCredentialUser({
        name: "C",
        email: "c@example.test",
        passwordHash: "hashed:first",
      });
      operators.add(op.id);
      await app.deactivate({ id: gone.id, actor: { type: "system", id: null } });
      const caller = { id: customer.id, operatorId: op.id, impersonated: true };

      await expect(app.deactivateAccount({ userId: other.id, caller })).rejects.toBeInstanceOf(
        UserAccountAccessDeniedError,
      );
      await expect(app.reactivateAccount({ userId: gone.id, caller })).rejects.toBeInstanceOf(
        UserAccountAccessDeniedError,
      );
      await expect(app.findById({ id: other.id })).resolves.toMatchObject({ deactivatedAt: null });
      await expect(app.findById({ id: gone.id })).resolves.toMatchObject({
        deactivatedAt: expect.any(Date),
      });
    });
  });

  describe("given the account is the last active platform operator", () => {
    /** @scenario "Deactivating the last active platform operator is refused" */
    it("refuses with user_last_platform_operator, and writes and records nothing", async () => {
      const operators = new Set<string>();
      const { senders, recorded } = createUserTestLifecycle();
      const app = createUserTestApp({
        dependencies: { authz: createUserTestAuthorization(operators) },
        lifecycle: senders,
      });
      const operator = await account(app);
      operators.add(operator.id);

      await expect(
        app.deactivate({ id: operator.id, actor: { type: "system", id: null } }),
      ).rejects.toBeInstanceOf(UserLastPlatformOperatorError);
      await expect(app.findById({ id: operator.id })).resolves.toMatchObject({
        deactivatedAt: null,
      });
      expect(recorded).toEqual([]);
    });

    /** @scenario "Deactivating the last active platform operator is refused" */
    it("deactivates an operator while another active operator remains", async () => {
      const operators = new Set<string>();
      const app = createUserTestApp({
        dependencies: { authz: createUserTestAuthorization(operators) },
      });
      const operator = await account(app);
      const other = await app.createCredentialUser({
        name: "Other",
        email: "other@example.test",
        passwordHash: "hashed:first",
      });
      operators.add(operator.id).add(other.id);

      await app.deactivate({ id: operator.id, actor: { type: "system", id: null } });

      await expect(app.findById({ id: operator.id })).resolves.toMatchObject({
        deactivatedAt: expect.any(Date),
      });
    });
  });

  describe("given authz still lists an operator user has already deactivated", () => {
    /** @scenario "An operator authz has not yet heard is deactivated does not count as active" */
    it("refuses to deactivate the only operator user still holds active", async () => {
      const operators = new Set<string>();
      const app = createUserTestApp({
        dependencies: { authz: createUserTestAuthorization(operators) },
      });
      const first = await account(app);
      const second = await app.createCredentialUser({
        name: "Second",
        email: "second@example.test",
        passwordHash: "hashed:first",
      });
      operators.add(first.id).add(second.id);

      await app.deactivate({ id: first.id, actor: { type: "system", id: null } });

      await expect(
        app.deactivate({ id: second.id, actor: { type: "system", id: null } }),
      ).rejects.toMatchObject({
        code: "user_last_platform_operator",
      });
      await expect(app.findById({ id: second.id })).resolves.toMatchObject({
        deactivatedAt: null,
      });
    });
  });

  describe("given an operator deactivates someone through the user operation", () => {
    /** @scenario "Deactivating a user invalidates every session family" */
    it("ends their browser sessions and CLI tokens on that door too", async () => {
      const auth = createUserTestAuth();
      const revokeForUser = vi.fn(async () => undefined);
      const app = createUserTestApp({
        dependencies: { auth },
        members: { cliCredentials: { revokeForUser } },
      });
      const created = await account(app);

      await app.deactivate({ id: created.id, actor: { type: "system", id: null } });

      expect(auth.revokeAllBrowserSessions).toHaveBeenCalledWith({ userId: created.id });
      expect(revokeForUser).toHaveBeenCalledWith({ userId: created.id });
    });

    /** @scenario "Deactivation ends access even when user's fact cannot be sent" */
    it("has ended their sessions and CLI tokens before the fact fails", async () => {
      const auth = createUserTestAuth();
      const revokeForUser = vi.fn(async () => undefined);
      const failing: UserLifecycleSenders = {
        recordUserDeactivated: {
          send: async () => {
            throw new Error("event store unavailable");
          },
        },
        recordUserReactivated: { send: async () => undefined },
      };
      const app = createUserTestApp({
        dependencies: { auth },
        members: { cliCredentials: { revokeForUser } },
        lifecycle: failing,
      });
      const created = await account(app);

      await expect(
        app.deactivate({ id: created.id, actor: { type: "system", id: null } }),
      ).rejects.toThrow("event store unavailable");

      expect(auth.revokeAllBrowserSessions).toHaveBeenCalledWith({ userId: created.id });
      expect(revokeForUser).toHaveBeenCalledWith({ userId: created.id });
    });
  });

  describe("given an account is deactivated and then reactivated", () => {
    /** @scenario "Deactivation and reactivation are recorded as user's facts" */
    it("records each change as user's fact, keyed to the account", async () => {
      const { senders, recorded } = createUserTestLifecycle();
      const app = createUserTestApp({ lifecycle: senders });
      const created = await account(app);

      await app.deactivate({ id: created.id, actor: { type: "system", id: null } });
      await app.reactivate({ id: created.id, actor: { type: "system", id: null } });

      expect(recorded.map(({ type }) => type)).toEqual(["deactivated", "reactivated"]);
      expect(recorded[0]?.data).toMatchObject({ tenantId: created.id, userId: created.id });
    });
  });

  describe("given an operator changes accounts, directly or while impersonating", () => {
    /** @scenario "A user's lifecycle fact records who made the change" */
    it("records the operator as the actor, and an older fact without one still reads", async () => {
      const operators = new Set<string>();
      const { senders, recorded } = createUserTestLifecycle();
      const app = createUserTestApp({
        lifecycle: senders,
        dependencies: { authz: createUserTestAuthorization(operators) },
      });
      const customer = await account(app);
      const op = await app.createCredentialUser({
        name: "Op",
        email: "op@example.test",
        passwordHash: "hashed:first",
      });
      operators.add(op.id);
      const direct = { id: op.id, operatorId: op.id, impersonated: false };

      await app.deactivateAccount({ userId: customer.id, caller: direct });
      await app.reactivateAccount({ userId: customer.id, caller: direct });
      await app.deactivateAccount({
        userId: customer.id,
        caller: { id: customer.id, operatorId: op.id, impersonated: true },
      });

      expect(recorded.map(({ data }) => data.actor)).toEqual([
        { type: "user", id: op.id },
        { type: "user", id: op.id },
        { type: "user", id: op.id },
      ]);
      expect(
        userLifecycleEventDataSchema.parse({ tenantId: "u", userId: "u", occurredAt: 1 }),
      ).not.toHaveProperty("actor");
    });
  });
});
