import { describe, expect, it } from "vitest";
import {
  type BackfillIdentifierRow,
  backfillParityDiffs,
  type ExpectedIdentifier,
  orphanedIdentifierRows,
} from "../backfill";

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
});
