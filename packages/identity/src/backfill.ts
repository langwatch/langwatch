import { sourceOfDerivedAccountId } from "./auth0-upstream";
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
  /**
   * better-auth's own provider id and the subject asserted under it — the
   * pair the projection's live unique index arbitrates, and therefore the
   * only pair a collision can be named by. Absent on an expectation no
   * protocol row backs (the email adopted from `User.email`), which is why
   * they are optional rather than nullable-and-required: an expectation that
   * names no subject can never lose one.
   */
  providerId?: string | null;
  providerAccountId?: string | null;
}

/**
 * A live identifier row holding a provider subject, WHOEVER it belongs to.
 *
 * Supplied rather than read out of `rows`, because the row that beat this
 * user to a subject is almost always another user's, and `rows` is one
 * user's projection. `IdentityBackfillRepository.findSubjectHolders` is the
 * read; this module stays pure.
 */
export interface SubjectHolder {
  identifierId: string;
  providerId: string;
  providerAccountId: string;
}

export type BackfillDiff = {
  kind:
    | "identifier_missing"
    | "subject_collision"
    | "subject_duplicate"
    | "state_mismatch"
    | "value_mismatch"
    | "surplus_row";
  identifierId: string;
  provider: string;
  expectedState?: string;
  actualState?: string;
  /** On `subject_collision` and `subject_duplicate`: the live identifier that
   *  already holds the provider subject this one expected. Named because a
   *  collision is remedied by a human merging two accounts, and neither id
   *  alone says which two. */
  holdingIdentifierId?: string;
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
 *
 * An absent identifier is reported as one of THREE things, because they ask
 * different things of the reader. `identifier_missing` heals by itself — the
 * fold has not caught up, and the next pass proves it. `subject_collision`
 * never does: another live identifier holds the provider subject, the fold
 * parked this one against the live unique index, and no number of passes
 * moves a subject off the incumbent. Only a person merging the two accounts
 * clears it, so the report has to say which one it is. `subject_duplicate` is
 * the same parking with the holder among this user's OWN rows: two of their
 * identifiers name one subject, nobody else is involved, there is nothing to
 * merge, and the sign-in method already works through the holder.
 */
export function backfillParityDiffs({
  rows,
  expected,
  subjectHolders = [],
}: {
  rows: BackfillIdentifierRow[];
  expected: ExpectedIdentifier[];
  subjectHolders?: SubjectHolder[];
}): BackfillDiff[] {
  const byId = new Map(rows.map((row) => [row.id, row]));
  const diffs: BackfillDiff[] = [];
  for (const expectation of expected) {
    const row = byId.get(expectation.identifierId);
    if (!row) {
      const holding = holderOfExpectedSubject({ expectation, subjectHolders });
      diffs.push({
        kind: absentIdentifierKind({ holding, ownRows: byId }),
        identifierId: expectation.identifierId,
        provider: expectation.provider,
        expectedState: expectation.expectedState,
        ...(holding === null ? {} : { holdingIdentifierId: holding }),
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

function absentIdentifierKind({
  holding,
  ownRows,
}: {
  holding: string | null;
  ownRows: ReadonlyMap<string, BackfillIdentifierRow>;
}): "identifier_missing" | "subject_collision" | "subject_duplicate" {
  if (holding === null) return "identifier_missing";
  return ownRows.has(holding) ? "subject_duplicate" : "subject_collision";
}

/**
 * The live identifier already holding the subject this expectation wants, or
 * null where nothing does.
 *
 * A holder under the expectation's OWN id is not a collision — it is a read
 * that raced the fold, the row landing between the projection read and the
 * holder read. Reporting it would send an operator to merge an account with
 * itself.
 */
function holderOfExpectedSubject({
  expectation,
  subjectHolders,
}: {
  expectation: ExpectedIdentifier;
  subjectHolders: SubjectHolder[];
}): string | null {
  const { providerId, providerAccountId } = expectation;
  if (
    providerId === null ||
    providerId === undefined ||
    providerAccountId === null ||
    providerAccountId === undefined
  ) {
    return null;
  }
  const holder = subjectHolders.find(
    (candidate) =>
      candidate.providerId === providerId &&
      candidate.providerAccountId === providerAccountId &&
      candidate.identifierId !== expectation.identifierId,
  );
  return holder?.identifierId ?? null;
}

/**
 * The compensating half: identifiers adopted from an `Account` row that no
 * longer exists. Identifiers without an account (the email) are never the
 * backfill's to detach; tombstones are already detached. A DERIVED
 * identifier's liveness follows its SOURCE row — the broker account its
 * subject was unfolded from — because no `Account` row of its own will ever
 * exist to keep it alive, and the fact it states dies with the row that
 * asserted it.
 */
export function orphanedIdentifierRows({
  rows,
  liveAccountIds,
}: {
  rows: BackfillIdentifierRow[];
  liveAccountIds: ReadonlySet<string>;
}): BackfillIdentifierRow[] {
  const liveness = (accountId: string): string =>
    sourceOfDerivedAccountId(accountId) ?? accountId;
  return rows.filter(
    (row) =>
      row.accountId !== null &&
      !liveAccountIds.has(liveness(row.accountId)) &&
      isLiveIdentifierState(row.state),
  );
}
