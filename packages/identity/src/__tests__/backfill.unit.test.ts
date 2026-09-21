import { describe, expect, it } from "vitest";
import {
  type BackfillIdentifierRow,
  backfillParityDiffs,
  type ExpectedIdentifier,
  orphanedIdentifierRows,
} from "../backfill";
import { derivedAccountId } from "../auth0-upstream";


function row(overrides: Partial<BackfillIdentifierRow>): BackfillIdentifierRow {
  return {
    id: "idf_email",
    provider: "email",
    value: "sam@acme.com",
    accountId: null,
    state: "VERIFIED",
    ...overrides,
  };
}

const EMAIL: ExpectedIdentifier = {
  identifierId: "idf_email",
  provider: "email",
  value: "sam@acme.com",
  expectedState: "VERIFIED",
};

describe("backfill parity", () => {
  describe("when the heads carry exactly what the legacy rows imply", () => {
    /** @scenario "The backfill adopts existing accounts and proves itself per user" */
    it("reports no diff", () => {
      expect(
        backfillParityDiffs({ rows: [row({})], expected: [EMAIL] }),
      ).toEqual([]);
    });

    it("accepts PRIMARY for VERIFIED, and any live state for ATTACHED", () => {
      expect(
        backfillParityDiffs({
          rows: [row({ state: "PRIMARY" })],
          expected: [EMAIL],
        }),
      ).toEqual([]);
      expect(
        backfillParityDiffs({
          rows: [row({ state: "PRIMARY" })],
          expected: [{ ...EMAIL, expectedState: "ATTACHED" }],
        }),
      ).toEqual([]);
    });
  });

  describe("when the heads disagree with the legacy rows", () => {
    it("names a missing identifier", () => {
      expect(backfillParityDiffs({ rows: [], expected: [EMAIL] })).toEqual([
        expect.objectContaining({
          kind: "identifier_missing",
          identifierId: "idf_email",
        }),
      ]);
    });

    it("names a dead-ended or detached identifier as a state mismatch", () => {
      expect(
        backfillParityDiffs({
          rows: [row({ state: "DEAD_END" })],
          expected: [EMAIL],
        }),
      ).toEqual([
        expect.objectContaining({
          kind: "state_mismatch",
          expectedState: "VERIFIED",
          actualState: "DEAD_END",
        }),
      ]);
    });

    it("names a value the projection carries differently", () => {
      expect(
        backfillParityDiffs({
          rows: [row({ value: "old@acme.com" })],
          expected: [EMAIL],
        }),
      ).toEqual([expect.objectContaining({ kind: "value_mismatch" })]);
    });

    it("names a live row nothing implies, and ignores surplus tombstones", () => {
      const stale = row({ id: "idf_stale", value: "old@acme.com" });
      expect(
        backfillParityDiffs({ rows: [row({}), stale], expected: [EMAIL] }),
      ).toEqual([
        expect.objectContaining({
          kind: "surplus_row",
          identifierId: "idf_stale",
          actualState: "VERIFIED",
        }),
      ]);
      expect(
        backfillParityDiffs({
          rows: [row({}), { ...stale, state: "DETACHED" }],
          expected: [EMAIL],
        }),
      ).toEqual([]);
    });
  });

  describe("when an expected identifier's subject is held by another live row", () => {
    const GOOGLE: ExpectedIdentifier = {
      identifierId: "idf_google",
      provider: "google",
      value: "sam@acme.com",
      expectedState: "VERIFIED",
      providerId: "google",
      providerAccountId: "google-sub-1",
    };

    /** @scenario "The losing user is held with the collision named in the report" */
    it("names a subject collision and the row holding the subject", () => {
      expect(
        backfillParityDiffs({
          rows: [row({})],
          expected: [EMAIL, GOOGLE],
          subjectHolders: [
            {
              identifierId: "idf_incumbent",
              providerId: "google",
              providerAccountId: "google-sub-1",
            },
          ],
        }),
      ).toEqual([
        {
          kind: "subject_collision",
          identifierId: "idf_google",
          provider: "google",
          expectedState: "VERIFIED",
          holdingIdentifierId: "idf_incumbent",
        },
      ]);
    });

    /** @scenario "A user whose own identifier already holds the subject is not sent for a merge" */
    it("names a duplicate, not a collision, when the holder is the user's own row", () => {
      const own = row({
        id: "idf_google_own",
        provider: "google",
        accountId: "acc_google",
      });
      expect(
        backfillParityDiffs({
          rows: [row({}), own],
          expected: [
            EMAIL,
            { ...GOOGLE, identifierId: "idf_google_own" },
            GOOGLE,
          ],
          subjectHolders: [
            {
              identifierId: "idf_google_own",
              providerId: "google",
              providerAccountId: "google-sub-1",
            },
          ],
        }),
      ).toEqual([
        {
          kind: "subject_duplicate",
          identifierId: "idf_google",
          provider: "google",
          expectedState: "VERIFIED",
          holdingIdentifierId: "idf_google_own",
        },
      ]);
    });

    it("stays an ordinary missing identifier when no row holds the subject", () => {
      // Nothing holds it, so the identifier is simply not projected yet and
      // the next pass heals it; only a held subject needs a human.
      expect(
        backfillParityDiffs({
          rows: [row({})],
          expected: [EMAIL, GOOGLE],
          subjectHolders: [
            {
              identifierId: "idf_other",
              providerId: "github",
              providerAccountId: "google-sub-1",
            },
          ],
        }),
      ).toEqual([
        expect.objectContaining({
          kind: "identifier_missing",
          identifierId: "idf_google",
        }),
      ]);
      expect(
        backfillParityDiffs({ rows: [row({})], expected: [EMAIL, GOOGLE] }),
      ).toEqual([
        expect.objectContaining({
          kind: "identifier_missing",
          identifierId: "idf_google",
        }),
      ]);
    });

    it("ignores a holder that is the expected identifier itself", () => {
      // The row is absent while a holder under the SAME id is reported: a
      // read that raced the fold, not a collision. Reporting it as one would
      // send an operator to merge an account with itself.
      expect(
        backfillParityDiffs({
          rows: [row({})],
          expected: [EMAIL, GOOGLE],
          subjectHolders: [
            {
              identifierId: "idf_google",
              providerId: "google",
              providerAccountId: "google-sub-1",
            },
          ],
        }),
      ).toEqual([
        expect.objectContaining({
          kind: "identifier_missing",
          identifierId: "idf_google",
        }),
      ]);
    });
  });
});

describe("orphaned identifier rows", () => {
  /** @scenario "The backfill detaches identifiers whose account row is gone" */
  it("selects live rows whose account is gone; never the email, never a tombstone", () => {
    const rows = [
      row({}),
      row({ id: "idf_google", provider: "google", accountId: "acc_gone" }),
      row({ id: "idf_github", provider: "github", accountId: "acc_live" }),
      row({
        id: "idf_old",
        provider: "gitlab",
        accountId: "acc_gone_too",
        state: "DETACHED",
      }),
    ];
    expect(
      orphanedIdentifierRows({
        rows,
        liveAccountIds: new Set(["acc_live"]),
      }).map((orphan) => orphan.id),
    ).toEqual(["idf_google"]);
  });

  /** @scenario "An Auth0-brokered social account is adopted under its own provider too" */
  it("follows a derived identifier's liveness to its source row", () => {
    const rows = [
      row({
        id: "idf_derived_live",
        provider: "google",
        accountId: derivedAccountId({
          sourceAccountId: "acc_live",
          providerId: "google",
        }),
      }),
      row({
        id: "idf_derived_gone",
        provider: "google",
        accountId: derivedAccountId({
          sourceAccountId: "acc_gone",
          providerId: "google",
        }),
      }),
    ];
    // No `Account` row of a derived identifier's own will ever exist, so a
    // liveness read on its literal accountId would detach it every pass;
    // what it must follow is the broker row its subject was unfolded from.
    expect(
      orphanedIdentifierRows({
        rows,
        liveAccountIds: new Set(["acc_live"]),
      }).map((orphan) => orphan.id),
    ).toEqual(["idf_derived_gone"]);
  });
});
