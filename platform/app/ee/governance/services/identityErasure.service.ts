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
 *   3. replace the identifier and display text on the person row itself,
 *      keeping the row so its spend stays attributable to somebody;
 *   4. delete the money rows carrying the identifier and replay those days, so
 *      they come back under the pseudonym with their totals intact;
 *   5. — which only works because the fold consults the same suppression list
 *      on its way past (`actorIdForRollupWrite`), so this service refreshes the
 *      in-process snapshot between step 1 and step 4.
 *
 * Order matters in one direction: the suppression row must exist before the
 * replay, or the replay re-derives the original identifier from the raw event
 * log and writes it straight back.
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
} from "../repositories/governanceIdentity.repository";
import type { GovernanceRollupErasureClickHouseRepository } from "./governanceRollupErasure.clickhouse.repository";
import { erasureDigest, readErasureSecret } from "./logic/erasureDigest";
import type { SuppressionSnapshot } from "./logic/suppressionSnapshot";

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

/** What one erasure did, and what it could not reach. */
export interface ErasureOutcome {
  discoveredPersonId: string;
  /** The stable value written wherever the identifier used to be. */
  pseudonym: string;
  /** Digests newly added to the suppression list (0 when already erased). */
  suppressionRowsRecorded: number;
  /** Platform-user references blanked across the person's links. */
  identityMatchesBlanked: number;
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
}

export interface IdentityErasureDeps {
  prisma: PrismaClient;
  tenantHistory: GovernanceTenantHistoryRepository;
  suppression: ErasedIdentifierSuppressionRepository;
  discoveredPeople: DiscoveredPersonRepository;
  identityMatches: IdentityMatchRepository;
  rollupErasure: GovernanceRollupErasureClickHouseRepository;
  replay: RollupReplayPort;
  snapshot: SuppressionSnapshot;
  /**
   * How far back the event log still holds events. Days older than this cannot
   * be replayed, so they are reported as not rebuilt instead of being retried
   * forever. Null means the caller cannot state a horizon, in which case every
   * day is attempted and none is pre-emptively declared unreachable.
   */
  replayHorizon: () => Date | null;
  now?: () => Date;
}

export class IdentityErasureService {
  constructor(private readonly deps: IdentityErasureDeps) {}

  /**
   * Erases one discovered person from the governance data.
   *
   * Idempotent: erasing an already-erased person recomputes the same digest
   * from the pseudonym it already holds... which it cannot, because the
   * original is gone. So a second call is a no-op that reports the pseudonym
   * already in place rather than hashing a hash.
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
    // would leave the list quietly growing with entries that cannot fire.
    if (person.erasedAt) {
      return {
        discoveredPersonId,
        pseudonym: person.rawActorId,
        suppressionRowsRecorded: 0,
        identityMatchesBlanked: 0,
        affectedDays: [],
        daysNotRebuilt: [],
      };
    }

    const secret = readErasureSecret();
    const original = person.rawActorId;
    // One digest, two jobs: the membership test the write paths run, and the
    // value written in place of the original. Hence no mapping table anywhere.
    const pseudonym = erasureDigest({ secret, identifier: original });
    // The display text is erased too, and separately: a provider that put
    // "Maria Silva" in one field and an opaque id in the other has published
    // two identifiers, and suppressing only the one we happen to key on lets
    // the other back in on the next pull.
    const displayDigest =
      person.displayText === original
        ? pseudonym
        : erasureDigest({ secret, identifier: person.displayText });

    // Step 1 — the do-not-reimport list, before anything else. A crash after
    // this point leaves the identifier suppressed but not yet removed, which is
    // recoverable by re-running. A crash before it, with the rows already
    // deleted, would let the next pull put them straight back.
    const suppressionRowsRecorded = await this.deps.suppression.recordAll(
      this.deps.prisma,
      {
        organizationId,
        provider: person.provider,
        identifierHashes:
          displayDigest === pseudonym
            ? [pseudonym]
            : [pseudonym, displayDigest],
        erasedAt: now,
      },
    );

    // Step 5's precondition: every fold in THIS process must see the new
    // suppression rows before the replay below runs, or the replay re-derives
    // the identifier it is meant to be erasing.
    await this.deps.snapshot.refreshNow();

    // Step 2 — the links keep their dates; only the platform user goes.
    const identityMatchesBlanked =
      await this.deps.identityMatches.blankUserReferences(this.deps.prisma, {
        organizationId,
        discoveredPersonId,
      });

    // Step 3 — the person row survives under the pseudonym.
    await this.deps.discoveredPeople.pseudonymize(this.deps.prisma, {
      id: discoveredPersonId,
      organizationId,
      pseudonym,
      erasedAt: now,
    });

    const { affectedDays, daysNotRebuilt } = await this.eraseFromMoneyRows({
      organizationId,
      discoveredPersonId,
      rawActorId: original,
    });

    return {
      discoveredPersonId,
      pseudonym,
      suppressionRowsRecorded,
      identityMatchesBlanked,
      affectedDays,
      daysNotRebuilt,
    };
  }

  /**
   * Step 4: the daily totals, across every tenant this organization has ever
   * written under.
   *
   * The tenant list comes from the persisted history and never from the live
   * resolver, which filters archived projects — one archive and this method
   * would erase nothing and report success.
   *
   * Delete first, then replay. The identifier is part of what addresses a row,
   * so there is no edit that removes it; the rows go, and the replay puts them
   * back with the fold substituting the pseudonym on its way past.
   */
  private async eraseFromMoneyRows({
    organizationId,
    discoveredPersonId,
    rawActorId,
  }: {
    organizationId: string;
    discoveredPersonId: string;
    rawActorId: string;
  }): Promise<{
    affectedDays: { tenantId: string; day: string }[];
    daysNotRebuilt: { tenantId: string; day: string }[];
  }> {
    const tenantIds = (
      await this.deps.tenantHistory.findAllByOrganization(this.deps.prisma, {
        organizationId,
      })
    ).map((row) => row.tenantId);

    const affectedDays = await this.deps.rollupErasure.findDaysCarryingActor({
      tenantIds,
      rawActorId,
    });

    await this.deps.rollupErasure.deleteRowsCarryingActor({
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

    if (replayable.length > 0) {
      const since = replayable.map((entry) => entry.day).sort()[0] as string;
      await this.deps.replay.replaySince({ tenantIds, since });
    }

    if (daysNotRebuilt.length > 0) {
      logger.warn(
        { organizationId, discoveredPersonId, daysNotRebuilt },
        "Erasure removed money rows from days the event log can no longer rebuild; those days' totals are now lower by the erased amount",
      );
    }

    return { affectedDays, daysNotRebuilt };
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
