import type { IdentifierArrivalState, IdentifierProvider } from "./vocabulary";
import { isLiveIdentifierState } from "./vocabulary";

/**
 * The backfill's parity policy (ADR-101 §6): what the fold-built rows must
 * look like for a user to count as proven, stated as pure functions over
 * row shapes. `@langwatch/identity-server`'s IdentityBackfillService drives
 * the pass; this module only says what agreement means.
 */

export interface BackfillIdentifierRow {
  id: string;
  provider: string;
  value: string | null;
  accountId: string | null;
  state: string;
}

/** One identifier the legacy rows imply, in the state they imply. */
export interface ExpectedIdentifier {
  identifierId: string;
  provider: IdentifierProvider;
  value: string;
  /** VERIFIED-or-better; ATTACHED means any live state is acceptable. */
  expectedState: IdentifierArrivalState;
}

export type BackfillDiff = {
  kind:
    | "identifier_missing"
    | "state_mismatch"
    | "value_mismatch"
    | "surplus_row";
  identifierId: string;
  provider: string;
  expectedState?: string;
  actualState?: string;
};

/** ATTACHED is satisfied by any live state; VERIFIED by VERIFIED-or-PRIMARY. */
export function identifierStateSatisfies(
  actual: string,
  expected: IdentifierArrivalState,
): boolean {
  if (expected === "VERIFIED") {
    return actual === "VERIFIED" || actual === "PRIMARY";
  }
  return isLiveIdentifierState(actual);
}

/**
 * The D01 exit gate: the fold-built rows against what the live rows imply,
 * in both directions. Forward: every expected identifier is present in its
 * expected state with its expected value. Backward: any LIVE row nothing
 * implies (say, the stale VERIFIED identifier of an email the user has
 * since changed — accountId null, so never orphan-detachable) is a
 * `surplus_row` diff, because such a row keeps blocking its value for every
 * other user; DETACHED and DEAD_END surpluses are inert tombstones and fine.
 */
export function backfillParityDiffs({
  rows,
  expected,
}: {
  rows: BackfillIdentifierRow[];
  expected: ExpectedIdentifier[];
}): BackfillDiff[] {
  const byId = new Map(rows.map((row) => [row.id, row]));
  const diffs: BackfillDiff[] = [];
  for (const expectation of expected) {
    const row = byId.get(expectation.identifierId);
    if (!row) {
      diffs.push({
        kind: "identifier_missing",
        identifierId: expectation.identifierId,
        provider: expectation.provider,
        expectedState: expectation.expectedState,
      });
      continue;
    }
    if (!identifierStateSatisfies(row.state, expectation.expectedState)) {
      diffs.push({
        kind: "state_mismatch",
        identifierId: expectation.identifierId,
        provider: expectation.provider,
        expectedState: expectation.expectedState,
        actualState: row.state,
      });
    }
    if (row.value !== expectation.value) {
      diffs.push({
        kind: "value_mismatch",
        identifierId: expectation.identifierId,
        provider: expectation.provider,
      });
    }
  }
  const expectedIds = new Set(
    expected.map((expectation) => expectation.identifierId),
  );
  for (const row of rows) {
    if (expectedIds.has(row.id) || !isLiveIdentifierState(row.state)) continue;
    diffs.push({
      kind: "surplus_row",
      identifierId: row.id,
      provider: row.provider,
      actualState: row.state,
    });
  }
  return diffs;
}

/**
 * The compensating half: identifiers adopted from an `Account` row that no
 * longer exists. Identifiers without an account (the email) are never the
 * backfill's to detach; tombstones are already detached.
 */
export function orphanedIdentifierRows({
  rows,
  liveAccountIds,
}: {
  rows: BackfillIdentifierRow[];
  liveAccountIds: ReadonlySet<string>;
}): BackfillIdentifierRow[] {
  return rows.filter(
    (row) =>
      row.accountId !== null &&
      !liveAccountIds.has(row.accountId) &&
      isLiveIdentifierState(row.state),
  );
}
