/** Spec: specs/identity/identifier-model.feature */
import { describe, expect, it } from "vitest";

import type {
  BackfillAccountRow,
  BackfillUserRow,
} from "../../repositories/identity-backfill.repository.ts";
import { CryptoIdentifierIdentityService } from "../crypto-identifier-identity.service.ts";
import { IdentityBackfillPlanService } from "../identity-backfill-plan.service.ts";

const plans = IdentityBackfillPlanService.create(CryptoIdentifierIdentityService.create());

const sam: BackfillUserRow & { email: string } = {
  id: "user_sam",
  email: "sam@acme.example",
  emailVerified: true,
  createdAtMs: Date.UTC(2023, 2, 14, 9, 30),
  userHashKey: "a-hash-key",
};

const auth0Row: BackfillAccountRow = {
  id: "acc_auth0",
  provider: "auth0",
  issuer: "https://acme.eu.auth0.com/",
  providerAccountId: "google-oauth2|108234",
  createdAtMs: Date.UTC(2023, 2, 14, 9, 31),
};

const googleRow: BackfillAccountRow = {
  id: "acc_google",
  provider: "google",
  issuer: "https://accounts.google.com",
  providerAccountId: "108234",
  createdAtMs: Date.UTC(2024, 5, 1, 12, 0),
};

describe("planning a user's identifiers from their legacy rows", () => {
  describe("given an Auth0 row naming a Google identity and a real Google row", () => {
    /** @scenario "Each account row is adopted under its own issuer, beside a real native row" */
    it("plans one identifier per row under that row's own provider and issuer", () => {
      const planned = plans.planIdentifiers({ user: sam, accounts: [auth0Row, googleRow] });

      expect(
        planned
          .filter((plan) => plan.accountId !== null)
          .map(({ accountId, providerId, issuer, providerAccountId }) => ({
            accountId,
            providerId,
            issuer,
            providerAccountId,
          })),
      ).toEqual([
        {
          accountId: "acc_auth0",
          providerId: "auth0",
          issuer: "https://acme.eu.auth0.com/",
          providerAccountId: "google-oauth2|108234",
        },
        {
          accountId: "acc_google",
          providerId: "google",
          issuer: "https://accounts.google.com",
          providerAccountId: "108234",
        },
      ]);
      expect(planned).toHaveLength(3);
    });
  });

  describe("given only the Auth0 row", () => {
    /** @scenario "An Auth0 row with nothing beside it plans one identifier under its own issuer" */
    it("plans the email and the Auth0 identifier, and derives no Google one", () => {
      const planned = plans.planIdentifiers({ user: sam, accounts: [auth0Row] });

      expect(planned.map((plan) => plan.providerId)).toEqual([null, "auth0"]);
      expect(planned[1]?.issuer).toBe("https://acme.eu.auth0.com/");
      expect(planned.some((plan) => plan.provider === "google")).toBe(false);
    });
  });
});
