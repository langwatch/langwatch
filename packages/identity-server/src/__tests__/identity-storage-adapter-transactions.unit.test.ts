/**
 * What the storage adapter promises about transactions, and what it refuses
 * to promise (see specs/identity/identity-storage-adapter.feature).
 *
 * Two things are settled here and the rest is settled against a real
 * database. The first is the DECLARATION: better-auth's single sign-on plugin
 * decides whether to run `resolveUser` at all by asking whether the adapter's
 * config carries a `transaction` FUNCTION, and for months it did not — so
 * every sign-in through a connection was refused with
 * `SSO_USER_RESOLUTION_REQUIRES_NATIVE_TRANSACTIONS` before it reached the
 * identity provider. The second is the BOUNDARY: the transaction is Postgres
 * and the identity branch's facts are not, so a callback that throws takes
 * the rows back and leaves the fact standing.
 *
 * Hermetic. The memory store keeps the transaction the only way it can — the
 * rows as they were before the callback, put back when it throws — which is
 * enough to pin the promise's SHAPE. That a provider row locked inside one of
 * these actually holds against a second link needs Postgres, and is proved in
 * the application's own suite.
 */
import { IDENTIFIER_ATTACHED_EVENT_TYPE } from "@langwatch/identity";
import { beforeEach, describe, expect, it } from "vitest";
import type { IdentityStack } from "./support/storage-adapter-stack";
import { identityStack, signUp } from "./support/storage-adapter-stack";

const EMAIL = "member@acme.com";

/** better-auth 1.7 keys an account by issuer; a social provider that names
 *  none gets this synthetic one. */
const oauthIssuer = (providerId: string): string =>
  `local:oauth:${encodeURIComponent(providerId)}`;

describe("the identity storage adapter's transaction", () => {
  let stack: IdentityStack;

  beforeEach(() => {
    stack = identityStack();
  });

  describe("when a plugin asks whether it supports native transactions", () => {
    /** @scenario "The adapter declares native transaction support" */
    it("carries a transaction function on its config, which is the question asked", async () => {
      const { adapter } = await stack.auth.$context;

      // `assertSSONativeTransactionSupport` in @better-auth/sso, verbatim:
      // anything other than a function is a `NOT_IMPLEMENTED` refusal of the
      // whole sign-in.
      expect(typeof adapter.options?.adapterConfig.transaction).toBe(
        "function",
      );
    });
  });

  describe("given a user on the identity branch", () => {
    beforeEach(() => {
      stack.gate.open = () => true;
    });

    describe("when a fact is appended inside a transaction that then throws", () => {
      /** @scenario "The transaction does not claim to span the event store" */
      it("takes the rows back and leaves the appended fact standing", async () => {
        await signUp(stack.auth, EMAIL);
        const userId = stack.db.user?.[0]?.id as string;
        const { adapter } = await stack.auth.$context;
        const attachedBefore = [...stack.events.rows.values()].filter(
          (fact) => fact.type === IDENTIFIER_ATTACHED_EVENT_TYPE,
        ).length;
        const abandoned = new Error("the ceremony failed after the append");

        await expect(
          adapter.transaction(async (transactional) => {
            await transactional.create({
              model: "verification",
              data: {
                identifier: "rolled-back",
                value: "proof",
                expiresAt: new Date(Date.now() + 60_000),
              },
            });
            await transactional.create({
              model: "account",
              data: {
                userId,
                providerId: "google",
                issuer: oauthIssuer("google"),
                accountId: "sub-google-1",
              },
            });
            // Both landed before the failure, so what the assertions below
            // read is a rollback rather than a write that never happened.
            expect(
              stack.db.verification?.some(
                (row) => row.identifier === "rolled-back",
              ),
            ).toBe(true);
            throw abandoned;
          }),
        ).rejects.toBe(abandoned);

        expect(
          stack.db.verification?.some(
            (row) => row.identifier === "rolled-back",
          ),
        ).toBe(false);
        expect(
          [...stack.events.rows.values()].filter(
            (fact) => fact.type === IDENTIFIER_ATTACHED_EVENT_TYPE,
          ),
        ).toHaveLength(attachedBefore + 1);
      });
    });
  });
});
