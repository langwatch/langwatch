/**
 * @vitest-environment node
 * Deactivation is three writes, not one: stopping at the durable flag would
 * leave a live session and a live command-line token belonging to somebody the
 * product says is gone. What this pins is that all three happen, in order.
 */
import { UserAccountAccessDeniedError } from "@langwatch/user-contract";
import { describe, expect, it, vi } from "vitest";

import {
  createUserTestApp,
  createUserTestAuth,
  createUserTestInfrastructure,
  createUserTestOps,
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

      await expect(app.tryFindById({ id: created.id })).resolves.toMatchObject({
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
    it("deactivates it, because the operator list is the standing", async () => {
      const app = createUserTestApp({ dependencies: { ops: createUserTestOps(true) } });
      const created = await account(app);
      const operator = await app.createCredentialUser({
        name: "Op",
        email: "op@example.test",
        passwordHash: "hashed:first",
      });

      await app.deactivateAccount({
        userId: created.id,
        caller: { id: operator.id, operatorId: operator.id, impersonated: false },
      });

      await expect(app.tryFindById({ id: created.id })).resolves.toMatchObject({
        deactivatedAt: expect.any(Date),
      });
    });
  });
});
