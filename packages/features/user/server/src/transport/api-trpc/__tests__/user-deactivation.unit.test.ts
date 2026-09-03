/**
 * @vitest-environment node
 *
 * Deactivation is three writes, not one. The durable flag is User's; the two
 * session families that outlive it are the process's, reached through the app
 * and through a port. A deactivation that stopped at the flag would leave a
 * live browser session and a live CLI token belonging to a user the product
 * says is gone, so what this suite pins is that all three happen, in order.
 */
import { initTRPC } from "@trpc/server";
import { describe, expect, it } from "vitest";
import type { UserApp } from "../../../app/user.app";
import { UserTrpcApi } from "../user.api";

const SELF = { id: "user_1", email: "person@example.test" };

function harness() {
  const reached: string[] = [];

  const users = new Proxy(
    {},
    {
      get(_target, property) {
        if (typeof property !== "string") {
          return undefined;
        }

        return () => {
          reached.push(property);
          if (property === "isAdmin") {
            return false;
          }
          return Promise.resolve(undefined);
        };
      },
    },
  ) as UserApp;

  const trpc = initTRPC.context<{ app: { users: UserApp }; session: unknown }>().create();
  const router = UserTrpcApi.create(
    trpc as never,
    {
      protected: trpc.procedure,
      public: trpc.procedure,
      policy: () => (procedure: unknown) => procedure,
    } as never,
    {
      revokeCliTokensForUser: async () => {
        reached.push("revokeCliTokensForUser");
      },
    } as never,
  );

  const caller = trpc.createCallerFactory(router as never)({
    app: { users },
    session: { user: SELF },
  });

  return { caller: caller as { deactivate(input: { userId: string }): Promise<unknown> }, reached };
}

describe("user.deactivate", () => {
  describe("given an active user", () => {
    describe("when the transport deactivates them", () => {
      /** @scenario "Deactivating a user invalidates every session family" */
      it("marks them deactivated, then revokes browser sessions, then revokes CLI tokens", async () => {
        const { caller, reached } = harness();

        await expect(caller.deactivate({ userId: SELF.id })).resolves.toEqual({ success: true });

        expect(reached).toEqual([
          "deactivate",
          "revokeAllBrowserSessions",
          "revokeCliTokensForUser",
        ]);
      });
    });
  });
});
