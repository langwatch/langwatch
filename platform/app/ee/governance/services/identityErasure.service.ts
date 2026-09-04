// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * Erasing a person from the governance data (ADR-128 §9).
 *
 * Keyed on `DiscoveredPerson`, never on the platform user, and that is the
 * whole design rather than a plumbing detail. Most discovered people have no
 * LangWatch login at all — contractors, seat holders who never signed in,
 * anyone whose email a provider put on a cost row — so there is no `userId` to
 * key on and a user-deletion event can never fire for them. Keying on the
 * platform user would have quietly scoped "every erasure path" to the minority
 * of discovered people who also happen to be customers of ours.
 *
 * The five steps, in the order they must happen:
 *
 *   1. record the identifier's digest on the suppression list, so the next
 *      thirty-day-lookback pull does not simply re-import what we erased;
 *   2. blank the platform-user reference on every link the person holds;
 *   3. delete the money rows carrying the identifier and ask for those days to
 *      be rebuilt, so they come back under the pseudonym with totals intact;
 *   4. replace the identifier and display text on the person row itself,
 *      keeping the row so its spend stays attributable to somebody;
 *   5. — which only works because the fold consults the same suppression list
 *      on its way past (`actorIdForRollupWrite`), so this service refreshes the
 *      in-process snapshot before any of the money work runs.
 *
 * Two orderings are load-bearing rather than incidental. The suppression row
 * must exist before the rebuild, or the rebuild re-derives the original
 * identifier from the raw event log and writes it straight back. And the money
 * rows must be deleted before the person row is pseudonymized, because the
 * delete addresses those rows BY the original identifier and the pseudonymize
 * destroys the last copy of it.
 *
 * Which leaves a window where the rows are gone and the rebuild has not
 * happened, and crossing it needs more than ordering. `moneyRowsPendingAt` is
 * written before the delete and cleared after the rebuild is accepted, with
 * `moneyRebuildSince` recording the day to start from while there is still
 * something to ask. A call that finds the marker standing resumes there rather
 * than reading `erasedAt` and reporting a clean erasure that did no work.
 *
 * Spec: specs/governance/governance-identity-and-erasure.feature
 */
import { createLogger } from "@langwatch/observability";
import type { PrismaClient } from "~/generated/prisma/client";

import type {
  DiscoveredPersonRepository,
  ErasedIdentifierSuppressionRepository,
  GovernanceTenantHistoryRepository,
  IdentityMatchRepository,
  IdentityMatchSuggestionRepository,
} from "../repositories/governanceIdentity.repository";
import type { GovernanceRollupErasureClickHouseRepository } from "./governanceRollupErasure.clickhouse.repository";
import { erasureDigest, readErasureSecret } from "./logic/erasureDigest";
import { refreshInstalledSuppressionSnapshot } from "./logic/suppressionSnapshot";

const logger = createLogger("langwatch:governance:identity-erasure");

/** Raised when the person named for erasure is not this organization's. */
export class DiscoveredPersonNotFoundError extends Error {
  name = "DiscoveredPersonNotFoundError" as const;
}

/**
 * Replays the given days so the fold rewrites them with the pseudonym.
 *
 * A port rather than a direct dependency because the replay runtime opens its
 * own Redis connection and iterates every registered pipeline — appropriate for
 * a rare admin operation, wrong to import into a service that unit tests have
 * to construct.
 *
 * `since` rather than a range because the replay engine has no upper bound: it
 * discovers affected aggregates from a lower bound and walks forward. Replaying
 * a superset of the affected days is safe — the fold is deterministic in the
 * event history, so a day replayed for no reason lands on the number it already
 * held.
 */
export interface RollupReplayPort {
  replaySince(params: { tenantIds: string[]; since: string }): Promise<void>;
}

/**
 * What one pass over this person's account references removed.
 *
 * An erasure makes more than one of these passes, so the counts are returned
 * rather than logged and forgotten: the two halves of an erasure add up into
 * `ErasureOutcome`, and a nonzero count from a pass that should have found
 * nothing is the signal that something wrote during the erasure.
 */
interface IdentityTrailSweep {
  identityMatchesBlanked: number;
  matchSuggestionsRemoved: number;
}

/** What one erasure did, and what it could not reach. */
export interface ErasureOutcome {
  discoveredPersonId: string;
  /** The stable value written wherever the identifier used to be. */
  pseudonym: string;
  /** Digests newly added to the suppression list (0 when already erased). */
  suppressionRowsRecorded: number;
  /**
   * Platform-user references blanked across the person's links, summed over
   * both sweeps.
   *
   * More than the person's link count means a match pass opened a link while
   * the erasure was running and the later sweep caught it. Worth the number
   * being visible rather than hidden behind "done".
   */
  identityMatchesBlanked: number;
  /**
   * Pending match suggestions deleted (ADR-128 §12).
   *
   * Nonzero on a fresh erasure means the person was sitting in somebody's
   * review queue. Nonzero on an erasure that had already finished means
   * something re-suggested an erased person, which is a bug worth the count
   * being visible for.
   */
  matchSuggestionsRemoved: number;
  /** Every `(tenant, day)` whose money rows carried the identifier. */
  affectedDays: { tenantId: string; day: string }[];
  /**
   * Days the money rows were deleted from but which could not be rebuilt,
   * because the event log no longer retains the events that day was folded
   * from. Those days' totals are now lower by the erased amount.
   *
   * Recorded rather than thrown, because the alternative to an incomplete
   * rebuild is leaving personal data in the table, and that is not an
   * alternative. Recorded rather than swallowed, because a total that silently
   * dropped is how finance stops trusting the screen.
   */
  daysNotRebuilt: { tenantId: string; day: string }[];
  /**
   * The day a rebuild of the daily totals was asked to start from, or null
   * where none was needed — no day carried the identifier, or every one of them
   * is older than the event log keeps.
   */
  rebuiltFrom: string | null;
  /**
   * True when this call picked up an earlier erasure that removed the money
   * rows and died before rebuilding them.
   *
   * Worth reporting rather than hiding: a resumed erasure means those totals
   * were wrong for however long the gap lasted, which is a thing an operator
   * asking "did that erasure work?" needs to be told.
   */
  resumed: boolean;
}

export interface IdentityErasureDeps {
  prisma: PrismaClient;
  tenantHistory: GovernanceTenantHistoryRepository;
  suppression: ErasedIdentifierSuppressionRepository;
  discoveredPeople: DiscoveredPersonRepository;
  identityMatches: IdentityMatchRepository;
  /**
   * The pending match suggestions for this person (ADR-128 §12).
   *
   * An erasure that blanked the links but left the suggestions behind left a
   * way back in: confirming a suggestion computed before the erasure opens a
   * fresh link on an erased person, which is the one thing "never matched
   * again" forbids. The nightly recompute would eventually drop the row, so the
   * window was up to a day wide rather than theoretical.
   */
  matchSuggestions: IdentityMatchSuggestionRepository;
  rollupErasure: GovernanceRollupErasureClickHouseRepository;
  replay: RollupReplayPort;
  /**
   * How far back the event log still holds events. Days older than this cannot
   * be replayed, so they are reported as not rebuilt instead of being retried
   * forever. Null means the caller cannot state a horizon, in which case every
   * day is attempted and none is pre-emptively declared unreachable.
   */
  replayHorizon: () => Date | null;
  now?: () => Date;
}

/**
 * Everything an erasure hashes about one person: the stand-in that replaces
 * their identifier, and every digest that goes on the suppression list.
 *
 * The display text is hashed too, and separately, because a provider that put
 * "Maria Silva" in one field and an opaque id in the other has published two
 * identifiers — suppressing only the one we happen to key on lets the other
 * back in on the next pull. When they are the same string it is one digest, not
 * the same digest twice.
 *
 * One digest, two jobs: it is the membership test every write path runs, and it
 * is the value written in place of the original. Which is why no table anywhere
 * maps a stand-in back to what it replaced.
 */
function digestsFor(person: { rawActorId: string; displayText: string }): {
  pseudonym: string;
  identifierHashes: string[];
} {
  const secret = readErasureSecret();
  const pseudonym = erasureDigest({ secret, identifier: person.rawActorId });
  if (person.displayText === person.rawActorId) {
    return { pseudonym, identifierHashes: [pseudonym] };
  }
  return {
    pseudonym,
    identifierHashes: [
      pseudonym,
      erasureDigest({ secret, identifier: person.displayText }),
    ],
  };
}

export class IdentityErasureService {
  constructor(private readonly deps: IdentityErasureDeps) {}

  /**
   * Erases one discovered person from the governance data.
   *
   * Idempotent in three states rather than two. An erasure that ran to
   * completion is a no-op on a second call: the original identifier is gone, so
   * re-deriving the digest is impossible and the pseudonym already in place is
   * reported instead of a hash of a hash.
   *
   * But an erasure that got as far as deleting the money rows and then died is
   * NOT finished, and it used to look finished — `erasedAt` was already stamped,
   * so the second call short-circuited and returned a clean outcome with no
   * affected days, while those days sat permanently short by the erased amount
   * and nothing anywhere said so. So the second call resumes at the money rows
   * instead, and reports what it actually did.
   */
  async erase({
    organizationId,
    discoveredPersonId,
  }: {
    organizationId: string;
    discoveredPersonId: string;
  }): Promise<ErasureOutcome> {
    const now = this.deps.now?.() ?? new Date();
    const person = await this.deps.discoveredPeople.findById(this.deps.prisma, {
      id: discoveredPersonId,
      organizationId,
    });
    if (!person) {
      throw new DiscoveredPersonNotFoundError(
        `No discovered person ${discoveredPersonId} in organization ${organizationId}`,
      );
    }

    // Hashing an already-pseudonymized value would put a digest-of-a-digest on
    // the suppression list, which matches nothing a provider will ever send and
    // would leave the list quietly growing with entries that cannot fire. So
    // the identity half never runs twice — but the money half might still be
    // owed, and this is the only place that ever finds out.
    if (person.erasedAt) {
      return await this.finishEarlierErasure({
        organizationId,
        discoveredPersonId,
        pseudonym: person.rawActorId,
        moneyRowsPendingAt: person.moneyRowsPendingAt,
        rebuildSince: person.moneyRebuildSince,
      });
    }

    const original = person.rawActorId;
    const { pseudonym, identifierHashes } = digestsFor(person);

    // Step 1 — the do-not-reimport list, before anything else. A crash before
    // it, with the rows already deleted, would let the next pull put them
    // straight back. A crash after it leaves the identifier suppressed but not
    // yet removed, which a re-run picks up: the identity half is idempotent by
    // `skipDuplicates` and a blank-if-set update, and the money half is
    // resumable because of the markers written around the delete below.
    const suppressionRowsRecorded = await this.deps.suppression.recordAll(
      this.deps.prisma,
      {
        organizationId,
        provider: person.provider,
        identifierHashes,
        erasedAt: now,
      },
    );

    // Step 5's precondition: every fold in THIS process must see the new
    // suppression rows before the replay below runs, or the replay re-derives
    // the identifier it is meant to be erasing.
    //
    // Deliberately not a `deps.snapshot` this service was handed. The thing
    // refreshed here has to be the same object `actorIdForRollupWrite` reads,
    // and an injected one could silently be a different instance — which fails
    // in the worst possible way: the replay writes the erased identifier back
    // and this method returns a clean outcome.
    await refreshInstalledSuppressionSnapshot();

    // Step 2 — the links keep their dates; only the platform user goes. The
    // pending questions about this person go entirely: a suggestion is an
    // invitation to open a link, and there must be none left to accept.
    const firstSweep = await this.sweepIdentityTrail({
      organizationId,
      discoveredPersonId,
    });

    const { affectedDays, daysNotRebuilt, rebuiltFrom } =
      await this.eraseFromMoneyRows({
        organizationId,
        discoveredPersonId,
        rawActorId: original,
        // A previous attempt that got as far as recording a plan keeps it: by
        // now the rows it was about to delete may already be gone, so asking
        // ClickHouse again would answer "no days affected" and quietly drop the
        // rebuild those deleted rows are still owed.
        recordedRebuildSince: person.moneyRebuildSince,
        at: now,
      });

    // Step 3 — the person row survives under the pseudonym. AFTER the delete,
    // because the delete addresses rows by the original identifier and this is
    // the write that destroys the last copy of it.
    await this.deps.discoveredPeople.pseudonymize(this.deps.prisma, {
      id: discoveredPersonId,
      organizationId,
      pseudonym,
      erasedAt: now,
    });

    const lateSweep = await this.finishMoneyRows({
      organizationId,
      discoveredPersonId,
      tenantIds: await this.tenantIdsFor(organizationId),
      rebuildSince: rebuiltFrom,
      daysNotRebuilt,
    });

    return {
      discoveredPersonId,
      pseudonym,
      suppressionRowsRecorded,
      identityMatchesBlanked:
        firstSweep.identityMatchesBlanked + lateSweep.identityMatchesBlanked,
      matchSuggestionsRemoved:
        firstSweep.matchSuggestionsRemoved + lateSweep.matchSuggestionsRemoved,
      affectedDays,
      daysNotRebuilt,
      rebuiltFrom,
      resumed: false,
    };
  }

  /**
   * What a second call does to somebody already erased: either nothing, or the
   * part the first call did not survive to do.
   *
   * The distinction is the whole of this review finding. Before it, both
   * answers were the empty one.
   */
  private async finishEarlierErasure({
    organizationId,
    discoveredPersonId,
    pseudonym,
    moneyRowsPendingAt,
    rebuildSince,
  }: {
    organizationId: string;
    discoveredPersonId: string;
    pseudonym: string;
    moneyRowsPendingAt: Date | null;
    rebuildSince: string | null;
  }): Promise<ErasureOutcome> {
    if (moneyRowsPendingAt) {
      return await this.resumeMoneyRows({
        organizationId,
        discoveredPersonId,
        pseudonym,
        rebuildSince,
      });
    }
    // Already finished. The sweep still runs, and it is not ceremony: the
    // person reads as erased from here on, so anything that put a link or a
    // suggestion back is a bug this call is the last chance to notice — a
    // nonzero count on a finished erasure says exactly that.
    const sweep = await this.sweepIdentityTrail({
      organizationId,
      discoveredPersonId,
    });
    return {
      discoveredPersonId,
      pseudonym,
      suppressionRowsRecorded: 0,
      identityMatchesBlanked: sweep.identityMatchesBlanked,
      matchSuggestionsRemoved: sweep.matchSuggestionsRemoved,
      affectedDays: [],
      daysNotRebuilt: [],
      rebuiltFrom: null,
      resumed: false,
    };
  }

  /**
   * Picks up an erasure whose identity half finished and whose money half did
   * not.
   *
   * The rows are already deleted — that happens before the identifier is
   * destroyed — so what is outstanding is the rebuild, and the day to start it
   * from was written down before the delete for exactly this moment.
   *
   * Reports `resumed`, and never a clean empty outcome: a second call that
   * silently returned "nothing to do" while a day sat short by the erased
   * amount is the failure this whole marker exists to end.
   */
  private async resumeMoneyRows({
    organizationId,
    discoveredPersonId,
    pseudonym,
    rebuildSince,
  }: {
    organizationId: string;
    discoveredPersonId: string;
    pseudonym: string;
    rebuildSince: string | null;
  }): Promise<ErasureOutcome> {
    logger.warn(
      { organizationId, discoveredPersonId, rebuildSince },
      "Resuming an erasure whose daily cost rows were removed but never rebuilt",
    );

    const sweep = await this.finishMoneyRows({
      organizationId,
      discoveredPersonId,
      tenantIds: await this.tenantIdsFor(organizationId),
      rebuildSince,
      daysNotRebuilt: [],
    });

    return {
      discoveredPersonId,
      pseudonym,
      suppressionRowsRecorded: 0,
      identityMatchesBlanked: sweep.identityMatchesBlanked,
      matchSuggestionsRemoved: sweep.matchSuggestionsRemoved,
      // Which days those were is not recoverable: the rows naming them are
      // gone and the identifier that addressed them is destroyed. The day the
      // rebuild starts from is what was kept, and it is what the rebuild needs.
      affectedDays: [],
      daysNotRebuilt: [],
      rebuiltFrom: rebuildSince,
      resumed: true,
    };
  }

  /**
   * Step 4's destructive half: work out what a rebuild will need, write that
   * down, and only then remove the rows.
   *
   * The tenant list comes from the persisted history and never from the live
   * resolver, which filters archived projects — one archive and this method
   * would erase nothing and report success.
   *
   * Delete rather than edit. The identifier is part of what addresses a row, so
   * there is no edit that removes it; the rows go, and a rebuild puts them back
   * with the fold substituting the pseudonym on its way past.
   */
  private async eraseFromMoneyRows({
    organizationId,
    discoveredPersonId,
    rawActorId,
    recordedRebuildSince,
    at,
  }: {
    organizationId: string;
    discoveredPersonId: string;
    rawActorId: string;
    recordedRebuildSince: string | null;
    at: Date;
  }): Promise<{
    affectedDays: { tenantId: string; day: string }[];
    daysNotRebuilt: { tenantId: string; day: string }[];
    rebuiltFrom: string | null;
  }> {
    const tenantIds = await this.tenantIdsFor(organizationId);

    const affectedDays = await this.deps.rollupErasure.findDaysCarryingActor({
      tenantIds,
      rawActorId,
    });

    const daysNotRebuilt = this.daysBeyondReplayHorizon(affectedDays);
    const replayable = affectedDays.filter(
      (candidate) =>
        !daysNotRebuilt.some(
          (lost) =>
            lost.tenantId === candidate.tenantId && lost.day === candidate.day,
        ),
    );
    const rebuiltFrom =
      recordedRebuildSince ??
      replayable.map((entry) => entry.day).sort()[0] ??
      null;

    // Before the delete, always. Once the rows are gone nothing can be asked
    // which days they were on, so a crash between here and the rebuild would
    // otherwise leave those days permanently short with nothing recording that
    // a rebuild was owed.
    await this.deps.discoveredPeople.markMoneyRowsPending(this.deps.prisma, {
      id: discoveredPersonId,
      organizationId,
      at,
      rebuildSince: rebuiltFrom,
    });

    await this.deps.rollupErasure.deleteRowsCarryingActor({
      tenantIds,
      rawActorId,
    });

    return { affectedDays, daysNotRebuilt, rebuiltFrom };
  }

  /**
   * Step 4's constructive half: ask for the rebuild, then declare the money
   * rows settled.
   *
   * The marker is cleared LAST, after the rebuild has been accepted. A throw
   * anywhere above leaves it standing, and the next call resumes here.
   */
  private async finishMoneyRows({
    organizationId,
    discoveredPersonId,
    tenantIds,
    rebuildSince,
    daysNotRebuilt,
  }: {
    organizationId: string;
    discoveredPersonId: string;
    tenantIds: string[];
    rebuildSince: string | null;
    daysNotRebuilt: { tenantId: string; day: string }[];
  }): Promise<IdentityTrailSweep> {
    if (rebuildSince) {
      await this.deps.replay.replaySince({ tenantIds, since: rebuildSince });
    }

    if (daysNotRebuilt.length > 0) {
      logger.warn(
        { organizationId, discoveredPersonId, daysNotRebuilt },
        "Erasure removed money rows from days the event log can no longer rebuild; those days' totals are now lower by the erased amount",
      );
    }

    await this.deps.discoveredPeople.settleMoneyRows(this.deps.prisma, {
      id: discoveredPersonId,
      organizationId,
    });

    // The second sweep, and the reason there are two. The first ran before the
    // person was marked erased, and until that mark lands both match passes
    // still read them as a live candidate — so a pass overlapping this erasure
    // could have opened a link or written a suggestion back in between. Here
    // the mark is set, and everything between the two sweeps is caught. Both
    // paths into this method are paths out of an erasure, so a run that died
    // after the mark and resumed still ends here.
    //
    // This narrows the window; it does not close it. A pass that read the
    // person BEFORE the mark and writes after this line still writes: the reads
    // are not held under a lock and nothing in the database refuses the row.
    // What actually delivers never-matched-again is the re-read on each write
    // path — `openProvenLink` and `confirmSuggestion` in `identityMatch.service.ts`
    // both check `erasedAt` immediately before writing. The sweeps are the
    // cleanup that makes those checks' remaining race small; they are not the
    // guarantee.
    const sweep = await this.sweepIdentityTrail({
      organizationId,
      discoveredPersonId,
    });
    if (sweep.identityMatchesBlanked > 0) {
      logger.warn(
        { organizationId, discoveredPersonId, ...sweep },
        "A link was opened on a person mid-erasure and has been blanked; a match pass was reading them as live while they were being erased",
      );
    }
    return sweep;
  }

  /**
   * Removes everything that points this person at a platform account: the
   * blanked links, and the pending suggestions that would open new ones.
   *
   * Both halves together, always, because they are one rule — a suggestion is
   * an invitation to open a link, so clearing the links while leaving the
   * invitations behind clears nothing. Idempotent by construction, which is
   * what lets an erasure call it more than once without any care about
   * ordering.
   */
  private async sweepIdentityTrail({
    organizationId,
    discoveredPersonId,
  }: {
    organizationId: string;
    discoveredPersonId: string;
  }): Promise<IdentityTrailSweep> {
    const identityMatchesBlanked =
      await this.deps.identityMatches.blankUserReferences(this.deps.prisma, {
        organizationId,
        discoveredPersonId,
      });
    const matchSuggestionsRemoved =
      await this.deps.matchSuggestions.deleteAllForPerson(this.deps.prisma, {
        organizationId,
        discoveredPersonId,
      });
    if (matchSuggestionsRemoved > 0) {
      logger.info(
        { organizationId, discoveredPersonId, matchSuggestionsRemoved },
        "Erasure removed pending identity match suggestions for the erased person",
      );
    }
    return { identityMatchesBlanked, matchSuggestionsRemoved };
  }

  /** Every area this organization has ever written governance rows under. */
  private async tenantIdsFor(organizationId: string): Promise<string[]> {
    const rows = await this.deps.tenantHistory.findAllByOrganization(
      this.deps.prisma,
      { organizationId },
    );
    return rows.map((row) => row.tenantId);
  }

  /**
   * The days whose rows are gone and are not coming back.
   *
   * ADR-022 makes the event log's retention the durability ceiling: for a day
   * older than it there is nothing left to replay from, so the delete is the
   * whole operation.
   */
  private daysBeyondReplayHorizon(
    days: { tenantId: string; day: string }[],
  ): { tenantId: string; day: string }[] {
    const horizon = this.deps.replayHorizon();
    if (!horizon) return [];
    const horizonDay = horizon.toISOString().slice(0, 10);
    return days.filter((entry) => entry.day < horizonDay);
  }
}
