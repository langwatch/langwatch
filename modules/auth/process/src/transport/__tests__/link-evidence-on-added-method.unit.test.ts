/**
 * ADR-117 §3's evidence rule at the seam a real sign-in reaches: better-auth's account hook.
 * @see specs/identity/signin-router.feature
 */
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { nowInstant, toDate } from "@langwatch/time";
import { describe, expect, it, vi } from "vitest";

import type { BetterAuthFederation } from "../../channels/better-auth.channel.ts";
import {
  createBeforeAccountCreateHook,
  type LinkProposals,
  type SsoDomainOrganizations,
} from "../../channels/http/http.better-auth-hooks.channel.ts";
import { MemoryAuthDatabase } from "../../repositories/memory/memory.auth.database.ts";
import { MemoryBetterAuthHooksRepository } from "../../repositories/memory/memory.better-auth-hooks.repository.ts";

const idTokenAsserting = (claims: Record<string, unknown>): string =>
  [
    Buffer.from(JSON.stringify({ alg: "RS256" })).toString("base64url"),
    Buffer.from(JSON.stringify(claims)).toString("base64url"),
    "signature-not-checked-here",
  ].join(".");

/** Somebody who already signs in one way, with a confirmed address. */
function establishedAccount({
  proposeLink = vi.fn().mockResolvedValue([]),
}: {
  proposeLink?: LinkProposals["proposeLink"];
} = {}) {
  const memory = MemoryAuthDatabase.create();
  memory.db.User.push({ id: "user_1", email: "sam@acme.test", emailVerified: true });
  memory.db.Account.push({
    id: "account-0",
    userId: "user_1",
    provider: "credential",
    providerAccountId: "user_1",
  });
  const hook = createBeforeAccountCreateHook({
    repo: MemoryBetterAuthHooksRepository.create({ memory }),
    organizations: createApiFixture<SsoDomainOrganizations>({ findBySsoDomain: async () => null }),
    federation: createApiFixture<BetterAuthFederation>({ platformSsoAllowed: async () => false }),
    findGoverningConnections: async () => [],
    linkProposals: createApiFixture<LinkProposals>({ proposeLink }),
  });
  const attach = (idToken: string | undefined) => {
    const now = toDate(nowInstant());
    return hook(
      {
        id: "account-1",
        userId: "user_1",
        providerId: "google",
        accountId: "google-sub-1",
        issuer: "https://google.issuer.test",
        idToken,
        createdAt: now,
        updatedAt: now,
      },
      null,
    );
  };
  return { attach, proposeLink, accountRows: () => memory.db.Account.length };
}

describe("given somebody who already signs in one way", () => {
  describe("when a second method's provider says the address is not verified", () => {
    /** @scenario "The evidence rule also guards a method added to an established account" */
    it("refuses the attachment and records a proposal an admin can resolve", async () => {
      const proposeLink = vi.fn().mockResolvedValue([]);
      const { attach, accountRows } = establishedAccount({ proposeLink });

      await expect(
        attach(idTokenAsserting({ email: "sam@acme.test", email_verified: false })),
      ).rejects.toMatchObject({ statusCode: 403, body: { code: "LINK_NEEDS_APPROVAL" } });

      expect(accountRows()).toBe(1);
      expect(proposeLink).toHaveBeenCalledTimes(1);
      expect(proposeLink.mock.calls[0]?.[0]).toMatchObject({
        tenantId: "user_1",
        userId: "user_1",
        provider: "google",
        providerAccountId: "google-sub-1",
        value: "sam@acme.test",
        reason: "unverified_orphan",
        connectionId: null,
        actor: { type: "system", id: null },
      });
    });

    it("still refuses when the proposal cannot be written", async () => {
      const { attach } = establishedAccount({
        proposeLink: vi.fn().mockRejectedValue(new Error("ledger down")),
      });

      await expect(
        attach(idTokenAsserting({ email: "sam@acme.test", email_verified: false })),
      ).rejects.toMatchObject({ body: { code: "LINK_NEEDS_APPROVAL" } });
    });
  });

  describe("when the provider makes no claim about the address", () => {
    /** @scenario "An identity provider that asserts nothing refuses nothing" */
    it.each([
      ["no token at all", undefined],
      ["a token with no claims", idTokenAsserting({})],
      ["an address with no verification claim", idTokenAsserting({ email: "sam@acme.test" })],
      ["an unparsable token", "not.a.jwt"],
    ])("attaches as before, given %s", async (_name, idToken) => {
      const { attach, proposeLink } = establishedAccount();

      await expect(attach(idToken)).resolves.toBeUndefined();
      expect(proposeLink).not.toHaveBeenCalled();
    });
  });

  describe("when both sides say the address is verified", () => {
    it("attaches the method", async () => {
      const { attach, proposeLink } = establishedAccount();

      await expect(
        attach(idTokenAsserting({ email: "sam@acme.test", email_verified: true })),
      ).resolves.toBeUndefined();
      expect(proposeLink).not.toHaveBeenCalled();
    });
  });
});
