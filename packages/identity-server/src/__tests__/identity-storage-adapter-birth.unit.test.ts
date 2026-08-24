/**
 * Born finalized: the entrance a flagged sign-up takes (ADR-116 §3), driven
 * by the real `betterAuth()`.
 *
 * The claim under test is not "the entrance writes rows" — it is that the
 * WHOLE request routes. better-auth creates the user and then, in the same
 * request, the credential account; the write gate cannot see the newborn's
 * state row on either write, because it reads on another connection behind a
 * TTL cache that answered before the user existed. So the marker set at the
 * auth route boundary is the only thing standing between a newborn and a
 * legacy `Account` row, and a suite that only checked the `user` create
 * would miss exactly that.
 *
 * The other half is failure. A flagged sign-up that cannot reach the engine
 * must FAIL rather than quietly land on the legacy branch — a test user born
 * on the old path would poison the rollout the flag exists to run.
 *
 * Hermetic: the ledger folds in memory and better-auth's own `memoryAdapter`
 * stands in for Prisma on the legacy branch.
 */
import { describe, expect, it } from "vitest";
import type { IdentityStack } from "./support/storage-adapter-stack";
import {
  flaggedSignUp,
  flaggedSignUpOrThrow,
  identityStack,
  signUp,
} from "./support/storage-adapter-stack";

const EMAIL = "newborn@acme.com";

type Stack = IdentityStack;

const userIdOf = (stack: Stack): string => stack.db.user?.[0]?.id as string;

const statedIdentifiers = (stack: Stack) =>
  [...stack.heads.heads.values()].flatMap((heads) =>
    Object.values(heads.identifiers),
  );

describe("better-auth over the born-finalized entrance", () => {
  describe("given a sign-up request carrying the identity-branch opt-in", () => {
    describe("when better-auth creates the user", () => {
      /** @scenario "A flagged sign-up is born finalized" */
      it("appends the attach facts, lands both rows, and finalizes the state row", async () => {
        const stack = identityStack();

        await flaggedSignUp(stack.auth, EMAIL);

        const userId = userIdOf(stack);
        expect(stack.commands.map((command) => command.type)).toContain(
          "lw.identity.attach_identifier",
        );
        // Under the NEW user's tenant, which is the newborn themselves —
        // identity tenants are users (ADR-101).
        expect(
          stack.commands.map(
            (command) => (command.data as { tenantId: string }).tenantId,
          ),
        ).toEqual([userId, userId]);

        // Both rows exist by the time sign-up returns: the identifier the
        // fold projected, and the credential row the account create wrote.
        expect(
          statedIdentifiers(stack).map((identifier) => identifier.value),
        ).toContain(EMAIL);
        expect(stack.storage.credentials.size).toBe(1);
        expect(stack.migrationState.get(userId)).toBe("finalized");
      });

      /** @scenario "The whole flagged request routes to the identity branch" */
      it("routes the credential account too, leaving no legacy Account row", async () => {
        const stack = identityStack();
        // The gate is shut for everyone and stays shut for the whole
        // request: the newborn's state row is younger than its cache.
        stack.gate.open = () => false;

        await flaggedSignUp(stack.auth, EMAIL);

        const credentialIdentifier = statedIdentifiers(stack).find(
          (identifier) => identifier.provider === "credential",
        );
        expect(credentialIdentifier).toBeDefined();
        expect(
          stack.storage.credentials.get(
            credentialIdentifier?.accountId as string,
          )?.secrets.password,
        ).toEqual(expect.any(String));
        expect(stack.db.account).toHaveLength(0);
      });

      /** @scenario "A retried flagged sign-up converges instead of duplicating" */
      it("converges on one user and one identifier when the entrance is retried", async () => {
        const stack = identityStack();
        // The first attempt reaches the engine and then dies before its rows
        // commit — the residual ADR-116 §3 names.
        const firstUserId = await bearWithoutRows(stack, EMAIL);
        expect(stack.commands).toHaveLength(1);
        expect(stack.db.user).toHaveLength(0);

        await flaggedSignUp(stack.auth, EMAIL);

        // The retry derived the same user id from the same address, so it
        // restated the same command — which the guard absorbs against heads
        // that already carry the identifier — and wrote the rows the first
        // attempt never did.
        expect(userIdOf(stack)).toBe(firstUserId);
        expect(stack.db.user).toHaveLength(1);
        expect(
          statedIdentifiers(stack).filter(
            (identifier) => identifier.provider === "email",
          ),
        ).toHaveLength(1);
      });

      /** @scenario "An abandoned flagged sign-up leaves no reachable identity" */
      it("leaves an address nothing resolves when the rows never commit", async () => {
        const stack = identityStack();

        await bearWithoutRows(stack, EMAIL);

        // Facts under a tenant that never gained a user row: nothing serves
        // them. The reconciliation sweep is what eventually removes the
        // stream; until it runs, the address names nobody on either branch.
        expect(stack.db.user).toHaveLength(0);
        const context = await stack.auth.$context;
        expect(
          await context.internalAdapter.findUserByEmail(EMAIL),
        ).toBeNull();
        // The claim the entrance wrote before the append is what makes the
        // orphan FINDABLE — the event store enumerates no aggregates, so an
        // unfolded stream leaves nothing else behind.
        expect([...stack.migrationState.values()]).toEqual(["migrated"]);
      });
    });

    describe("when the event-sourcing engine cannot accept an append", () => {
      /** @scenario "A flagged sign-up fails loudly when the engine is unavailable" */
      it("fails with the handled code and creates no user on either branch", async () => {
        const stack = identityStack();
        stack.engine.available = false;

        // The code survives better-auth's own error handling because the
        // adapter boundary turned the refusal into an APIError carrying it —
        // otherwise sign-up answers a generic FAILED_TO_CREATE_USER and the
        // presentation registry has nothing to key on.
        await expect(
          flaggedSignUpOrThrow(stack.auth, EMAIL),
        ).rejects.toMatchObject({
          body: { code: "identity_engine_unavailable" },
          statusCode: 503,
        });
        expect(stack.db.user).toHaveLength(0);
        expect(stack.db.account).toHaveLength(0);

        // An unflagged sign-up at the same moment is untouched by any of
        // this: it never reaches the entrance, so the engine's state is
        // irrelevant to it.
        await signUp(stack.auth, "unflagged@acme.com");
        expect(stack.db.user).toHaveLength(1);
        expect(stack.db.account).toHaveLength(1);
      });
    });
  });

  describe("given a sign-up request carrying no opt-in", () => {
    describe("when better-auth creates the user", () => {
      /** @scenario "An unflagged sign-up is untouched" */
      it("creates it with the stock behavior, states nothing, and leaves the gate closed", async () => {
        const stack = identityStack();

        await signUp(stack.auth, EMAIL);

        expect(stack.commands).toHaveLength(0);
        expect(statedIdentifiers(stack)).toHaveLength(0);
        expect(stack.storage.credentials.size).toBe(0);
        expect(stack.db.user).toHaveLength(1);
        expect(stack.db.account).toHaveLength(1);
        expect(stack.migrationState.size).toBe(0);
        expect(stack.gate.open(userIdOf(stack))).toBe(false);
      });
    });
  });
});

/**
 * An entrance that appended its facts and died before the rows committed —
 * ADR-116 §3's named residual. The engine goes away between the append and
 * the row write, which is what better-auth's `linkAccount` then trips over.
 */
async function bearWithoutRows(
  stack: Stack,
  email: string,
): Promise<string | undefined> {
  const originalPush = stack.db.user?.push.bind(stack.db.user);
  let bornUserId: string | undefined;
  if (stack.db.user) {
    stack.db.user.push = ((row: Record<string, unknown>) => {
      bornUserId = row.id as string;
      throw new Error("postgres went away before the newborn's rows committed");
    }) as typeof stack.db.user.push;
  }
  await expect(flaggedSignUpOrThrow(stack.auth, email)).rejects.toBeDefined();
  if (stack.db.user && originalPush) stack.db.user.push = originalPush;
  return bornUserId;
}
