import { derivedAccountId } from "@langwatch/identity";
import { describe, expect, it } from "vitest";
import type {
  BackfillAccountRow,
  BackfillUserRow,
} from "../identity-backfill.repository";
import { planIdentifiers } from "../identity-backfill-plan";

const USER: BackfillUserRow & { email: string } = {
  id: "user_sam",
  email: "Sam@Acme.com",
  emailVerified: true,
  createdAtMs: 1_700_000_000_000,
  userHashKey: "hash",
};

function account(overrides: Partial<BackfillAccountRow>): BackfillAccountRow {
  return {
    id: "acct_auth0",
    provider: "auth0",
    issuer: "local:oauth:auth0",
    providerAccountId: "google-oauth2|107698336211125",
    createdAtMs: 1_700_000_100_000,
    ...overrides,
  };
}

describe("the identifier backfill plan", () => {
  describe("given an Auth0 row whose subject names a Google identity", () => {
    /** @scenario "An Auth0-brokered social account is adopted under its own provider too" */
    it("plans the native identifier beside the adopted one", () => {
      const planned = planIdentifiers({ user: USER, accounts: [account({})] });

      const providers = planned.map((plan) => plan.providerId);
      expect(providers).toEqual([null, "auth0", "google"]);

      const derived = planned.find((plan) => plan.providerId === "google");
      expect(derived).toMatchObject({
        provider: "google",
        // The subject Google itself asserts, unwrapped from the broker's
        // namespace, under the issuer the native callback will ask for.
        providerAccountId: "107698336211125",
        issuer: "https://accounts.google.com",
        accountId: derivedAccountId({
          sourceAccountId: "acct_auth0",
          providerId: "google",
        }),
        commandId: "backfill:derived:acct_auth0:google",
        // The source row's own business time, so a restated pass derives
        // the same identifier id.
        occurredAtMs: 1_700_000_100_000,
        expectedState: "VERIFIED",
      });
    });

    it("keeps the adopted broker identifier byte-for-byte what it was", () => {
      const [, adopted] = planIdentifiers({
        user: USER,
        accounts: [account({})],
      });

      expect(adopted).toMatchObject({
        providerId: "auth0",
        issuer: "local:oauth:auth0",
        providerAccountId: "google-oauth2|107698336211125",
        accountId: "acct_auth0",
        commandId: "backfill:acct_auth0",
      });
    });

    it("restates the identical plan on a second pass", () => {
      const first = planIdentifiers({ user: USER, accounts: [account({})] });
      const second = planIdentifiers({ user: USER, accounts: [account({})] });

      expect(second).toEqual(first);
    });
  });

  describe("given a native row already asserting the unfolded pair", () => {
    /** @scenario "An Auth0-brokered social account is adopted under its own provider too" */
    it("stands the derivation down rather than planning a colliding identifier", () => {
      // The grace window's shape: the native providers mount beside the
      // broker, so a user can hold both the brokered and the native row for
      // one Google identity. Two live identifiers for the same (provider,
      // subject) pair would hit the projection's unique index — the loser
      // parks and the parity diff never clears — and the adopted native row
      // already states everything the derivation would have.
      const planned = planIdentifiers({
        user: USER,
        accounts: [
          account({}),
          account({
            id: "acct_native_google",
            provider: "google",
            issuer: "https://accounts.google.com",
            providerAccountId: "107698336211125",
          }),
        ],
      });

      expect(planned.map((plan) => plan.providerId)).toEqual([
        null,
        "auth0",
        "google",
      ]);
      // The one google identifier is the ADOPTED native row, not a derived
      // twin of the broker's.
      const google = planned.find((plan) => plan.providerId === "google");
      expect(google).toMatchObject({ accountId: "acct_native_google" });
    });

    it("still derives when the native row asserts a different subject", () => {
      const planned = planIdentifiers({
        user: USER,
        accounts: [
          account({}),
          account({
            id: "acct_native_google",
            provider: "google",
            issuer: "https://accounts.google.com",
            providerAccountId: "another-google-account",
          }),
        ],
      });

      expect(planned.map((plan) => plan.providerId)).toEqual([
        null,
        "auth0",
        "google",
        "google",
      ]);
    });
  });

  describe("given rows whose subjects name no native upstream", () => {
    /** @scenario "An Auth0-brokered social account is adopted under its own provider too" */
    it("derives nothing for broker database users, Microsoft, and non-Auth0 rows", () => {
      const planned = planIdentifiers({
        user: USER,
        accounts: [
          account({ id: "acct_db", providerAccountId: "auth0|64f1c9" }),
          account({ id: "acct_ms", providerAccountId: "waad|AbC1234" }),
          account({
            id: "acct_okta",
            provider: "okta",
            // An okta subject is the IdP's own; only the Auth0 broker's
            // compound namespace is ever unfolded.
            providerAccountId: "google-oauth2|107698336211125",
          }),
        ],
      });

      expect(planned.map((plan) => plan.providerId)).toEqual([
        null,
        "auth0",
        "auth0",
        "okta",
      ]);
    });
  });
});
