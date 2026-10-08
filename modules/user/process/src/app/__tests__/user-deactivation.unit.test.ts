/**
 * @vitest-environment node
 * User's half of deactivation: one write that refuses the last active operator, and the fact
 * recorded on its own. Auth runs the door and the revokes between the two
 * (modules/auth/specs/account-lifecycle.feature).
 */
import {
  UserAccountAccessDeniedError,
  UserLastPlatformOperatorError,
  userLifecycleEventDataSchema,
} from "@langwatch/user-contract";
import { describe, expect, it } from "vitest";

import {
  createUserTestApp,
  createUserTestAuthorization,
  createUserTestLifecycle,
} from "./user.fixture.ts";

const SELF = { id: "user_1", email: "person@example.test" };
const SYSTEM = { type: "system", id: null } as const;

async function account(app: ReturnType<typeof createUserTestApp>) {
  return app.createCredentialUser({
    name: "Person",
    email: SELF.email,
    passwordHash: "hashed:first",
  });
}

describe("user.deactivate", () => {
  describe("given an active user", () => {
    /** @scenario "Deactivation writes the account and records no fact" */
    it("marks them deactivated and records the fact only when asked, at the stored instant", async () => {
      const { senders, recorded } = createUserTestLifecycle();
      const app = createUserTestApp({ lifecycle: senders });
      const created = await account(app);
      recorded.length = 0;

      const written = await app.deactivate({ id: created.id, actor: SYSTEM });

      expect(written.deactivatedAt).toEqual(expect.any(Date));
      expect(recorded).toEqual([]);

      await app.recordDeactivated({ id: created.id, actor: SYSTEM });

      expect(recorded.map(({ type }) => type)).toEqual(["deactivated"]);
      expect(recorded[0]?.data).toMatchObject({
        userId: created.id,
        occurredAt: written.deactivatedAt?.getTime(),
      });
    });
  });

  describe("given a platform operator impersonating a customer", () => {
    /** @scenario "An impersonated session cannot reactivate any account" */
    it("refuses reactivating an account, and leaves it deactivated", async () => {
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
      const gone = await app.createCredentialUser({
        name: "C",
        email: "c@example.test",
        passwordHash: "hashed:first",
      });
      operators.add(op.id);
      await app.deactivate({ id: gone.id, actor: SYSTEM });
      const caller = { id: customer.id, operatorId: op.id, impersonated: true };

      await expect(app.reactivateAccount({ userId: gone.id, caller })).rejects.toBeInstanceOf(
        UserAccountAccessDeniedError,
      );
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
      recorded.length = 0;

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

  describe("given an account is deactivated and then reactivated", () => {
    /** @scenario "Deactivation and reactivation are recorded as user's facts" */
    it("records each change as user's fact, keyed to the account", async () => {
      const { senders, recorded } = createUserTestLifecycle();
      const app = createUserTestApp({ lifecycle: senders });
      const created = await account(app);
      recorded.length = 0;

      await app.deactivate({ id: created.id, actor: SYSTEM });
      await app.recordDeactivated({ id: created.id, actor: SYSTEM });
      await app.reactivate({ id: created.id, actor: SYSTEM });

      expect(recorded.map(({ type }) => type)).toEqual(["deactivated", "reactivated"]);
      expect(recorded[0]?.data).toMatchObject({ tenantId: created.id, userId: created.id });
    });
  });

  describe("given an operator changes accounts", () => {
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
      recorded.length = 0;
      const byOperator = { type: "user", id: op.id } as const;

      await app.deactivate({ id: customer.id, actor: byOperator });
      await app.recordDeactivated({ id: customer.id, actor: byOperator });
      await app.reactivateAccount({
        userId: customer.id,
        caller: { id: op.id, operatorId: op.id, impersonated: false },
      });

      expect(recorded.map(({ data }) => data.actor)).toEqual([byOperator, byOperator]);
      expect(
        userLifecycleEventDataSchema.parse({ tenantId: "u", userId: "u", occurredAt: 1 }),
      ).not.toHaveProperty("actor");
    });
  });
});
