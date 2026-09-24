// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import { DiscoveredPersonNotFoundError } from "@langwatch/enterprise-governance-contract";
import { createLogger, type Logger } from "@langwatch/observability";
import { nowInstant, type Instant } from "@langwatch/time";

import type { DiscoveredPersonRepository } from "../repositories/discovered-person.repository.ts";
import type { ErasedIdentifierSuppressionRepository } from "../repositories/erased-identifier-suppression.repository.ts";
import type { GovernanceTenantHistoryRepository } from "../repositories/governance-tenant-history.repository.ts";
import type { IdentityMatchSuggestionRepository } from "../repositories/identity-match-suggestion.repository.ts";
import type { IdentityMatchRepository } from "../repositories/identity-match.repository.ts";
import type {
  ErasedRollupDay,
  RollupErasureRepository,
} from "../repositories/rollup-erasure.repository.ts";
import { erasureDigestsFor, getErasureSecret } from "../rules/erasure-digest.rules.ts";
import type { SuppressionSnapshotService } from "./suppression-snapshot.service.ts";

/** Rebuilds the cost rollup from the event log for these tenants, from `since` (a UTC day). */
export interface RollupReplay {
  replaySince(input: { tenantIds: string[]; since: string }): Promise<void>;
}

interface IdentityTrailSweep {
  identityMatchesBlanked: number;
  matchSuggestionsRemoved: number;
}

/** What one erasure did, for the audit trail and the caller. */
export interface ErasureOutcome extends IdentityTrailSweep {
  discoveredPersonId: string;
  pseudonym: string;
  suppressionRowsRecorded: number;
  affectedDays: ErasedRollupDay[];
  /** Days older than the event log's horizon: removed, and not rebuildable. */
  daysNotRebuilt: ErasedRollupDay[];
  rebuiltFrom: string | null;
  /** True when this call finished an earlier erasure's daily-cost-row work. */
  resumed: boolean;
}

export interface IdentityErasureDependencies {
  discoveredPeople: DiscoveredPersonRepository;
  suppressions: ErasedIdentifierSuppressionRepository;
  identityMatches: IdentityMatchRepository;
  matchSuggestions: IdentityMatchSuggestionRepository;
  tenantHistory: GovernanceTenantHistoryRepository;
  rollupErasure: RollupErasureRepository;
  replay: RollupReplay;
  /** The same instance the fold reads, refreshed before the replay (ADR-128 §9 step 5). */
  suppressionSnapshot: SuppressionSnapshotService;
  /** The oldest instant the event log still holds, or null when it holds everything. */
  replayHorizon: () => Instant | null;
  erasureSecret: string | undefined;
  now?: () => Instant;
  logger?: Logger;
}

/**
 * Erases one provider-named person (ADR-128 §9): suppress, sweep links, remove and rebuild the
 * daily cost rows, pseudonymize in place. Resumable: `moneyRowsPendingAt` marks unfinished work.
 * Spec: specs/governance/governance-identity-and-erasure.feature
 */
export class IdentityErasureService {
  private readonly logger: Logger;
  private readonly now: () => Instant;

  private constructor(private readonly deps: IdentityErasureDependencies) {
    this.logger = deps.logger ?? createLogger("langwatch:governance:identity-erasure");
    this.now = deps.now ?? nowInstant;
  }

  static create(deps: IdentityErasureDependencies): IdentityErasureService {
    return new IdentityErasureService(deps);
  }

  async erase({
    organizationId,
    discoveredPersonId,
  }: {
    organizationId: string;
    discoveredPersonId: string;
  }): Promise<ErasureOutcome> {
    const now = this.now();
    const person = await this.deps.discoveredPeople.findById({
      id: discoveredPersonId,
      organizationId,
    });
    if (!person) {
      throw new DiscoveredPersonNotFoundError(
        `No discovered person ${discoveredPersonId} in organization ${organizationId}`,
      );
    }

    if (person.erasedAt) {
      return this.finishEarlierErasure({
        organizationId,
        discoveredPersonId,
        pseudonym: person.rawActorId,
        moneyRowsPending: person.moneyRowsPendingAt !== null,
        rebuildSince: person.moneyRebuildSince,
      });
    }

    const original = person.rawActorId;
    const { pseudonym, identifierHashes } = erasureDigestsFor({
      secret: getErasureSecret({ secret: this.deps.erasureSecret }),
      person,
    });

    const suppressionRowsRecorded = await this.deps.suppressions.recordAll({
      organizationId,
      provider: person.provider,
      identifierHashes,
      erasedAt: now,
    });

    await this.deps.suppressionSnapshot.refreshNow();

    const firstSweep = await this.sweepIdentityTrail({ organizationId, discoveredPersonId });

    const { affectedDays, daysNotRebuilt, rebuiltFrom } = await this.eraseFromMoneyRows({
      organizationId,
      discoveredPersonId,
      rawActorId: original,
      pseudonym,
      recordedRebuildSince: person.moneyRebuildSince,
      at: now,
    });

    await this.deps.discoveredPeople.pseudonymize({
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
      identityMatchesBlanked: firstSweep.identityMatchesBlanked + lateSweep.identityMatchesBlanked,
      matchSuggestionsRemoved:
        firstSweep.matchSuggestionsRemoved + lateSweep.matchSuggestionsRemoved,
      affectedDays,
      daysNotRebuilt,
      rebuiltFrom,
      resumed: false,
    };
  }

  private async finishEarlierErasure({
    organizationId,
    discoveredPersonId,
    pseudonym,
    moneyRowsPending,
    rebuildSince,
  }: {
    organizationId: string;
    discoveredPersonId: string;
    pseudonym: string;
    moneyRowsPending: boolean;
    rebuildSince: string | null;
  }): Promise<ErasureOutcome> {
    if (moneyRowsPending) {
      return this.resumeMoneyRows({ organizationId, discoveredPersonId, pseudonym, rebuildSince });
    }
    const sweep = await this.sweepIdentityTrail({ organizationId, discoveredPersonId });
    return {
      discoveredPersonId,
      pseudonym,
      suppressionRowsRecorded: 0,
      ...sweep,
      affectedDays: [],
      daysNotRebuilt: [],
      rebuiltFrom: null,
      resumed: false,
    };
  }

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
    this.logger.warn(
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
      ...sweep,
      affectedDays: [],
      daysNotRebuilt: [],
      rebuiltFrom: rebuildSince,
      resumed: true,
    };
  }

  /** Marks the rows pending BEFORE deleting them: afterwards nothing can say which days were owed. */
  private async eraseFromMoneyRows({
    organizationId,
    discoveredPersonId,
    rawActorId,
    pseudonym,
    recordedRebuildSince,
    at,
  }: {
    organizationId: string;
    discoveredPersonId: string;
    rawActorId: string;
    pseudonym: string;
    recordedRebuildSince: string | null;
    at: Instant;
  }): Promise<{
    affectedDays: ErasedRollupDay[];
    daysNotRebuilt: ErasedRollupDay[];
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
          (lost) => lost.tenantId === candidate.tenantId && lost.day === candidate.day,
        ),
    );
    const rebuiltFrom =
      recordedRebuildSince ?? replayable.map((entry) => entry.day).toSorted()[0] ?? null;

    await this.deps.discoveredPeople.markMoneyRowsPending({
      id: discoveredPersonId,
      organizationId,
      at,
      rebuildSince: rebuiltFrom,
    });
    await this.deps.rollupErasure.deleteRowsCarryingActor({ tenantIds, rawActorId });
    await this.deps.rollupErasure.renameActorInRestatementIndex({
      tenantIds,
      rawActorId,
      pseudonymousActorId: pseudonym,
    });

    return { affectedDays, daysNotRebuilt, rebuiltFrom };
  }

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
    daysNotRebuilt: ErasedRollupDay[];
  }): Promise<IdentityTrailSweep> {
    if (rebuildSince) await this.deps.replay.replaySince({ tenantIds, since: rebuildSince });

    if (daysNotRebuilt.length > 0) {
      this.logger.warn(
        { organizationId, discoveredPersonId, daysNotRebuilt },
        "Erasure removed money rows from days the event log can no longer rebuild; those days' totals are now lower by the erased amount",
      );
    }

    await this.deps.discoveredPeople.settleMoneyRows({ id: discoveredPersonId, organizationId });

    // A match pass that read the person as live mid-erasure may have opened a link; blank it.
    const sweep = await this.sweepIdentityTrail({ organizationId, discoveredPersonId });
    if (sweep.identityMatchesBlanked > 0) {
      this.logger.warn(
        { organizationId, discoveredPersonId, ...sweep },
        "A link was opened on a person mid-erasure and has been blanked; a match pass was reading them as live while they were being erased",
      );
    }
    return sweep;
  }

  private async sweepIdentityTrail(input: {
    organizationId: string;
    discoveredPersonId: string;
  }): Promise<IdentityTrailSweep> {
    const identityMatchesBlanked = await this.deps.identityMatches.blankUserReferences(input);
    const matchSuggestionsRemoved = await this.deps.matchSuggestions.deleteAllForPerson(input);
    if (matchSuggestionsRemoved > 0) {
      this.logger.info(
        { ...input, matchSuggestionsRemoved },
        "Erasure removed pending identity match suggestions for the erased person",
      );
    }
    return { identityMatchesBlanked, matchSuggestionsRemoved };
  }

  private async tenantIdsFor(organizationId: string): Promise<string[]> {
    const rows = await this.deps.tenantHistory.findAllByOrganization({ organizationId });
    return rows.map((row) => row.tenantId);
  }

  private daysBeyondReplayHorizon(days: ErasedRollupDay[]): ErasedRollupDay[] {
    const horizon = this.deps.replayHorizon();
    if (!horizon) return [];
    const horizonDay = horizon.toString().slice(0, 10);
    return days.filter((entry) => entry.day < horizonDay);
  }
}
