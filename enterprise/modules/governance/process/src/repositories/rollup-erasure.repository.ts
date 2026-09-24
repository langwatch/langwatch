// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/** One (tenant, UTC day) the cost rollup holds rows for an erased actor on. */
export interface ErasedRollupDay {
  tenantId: string;
  /** `YYYY-MM-DD`, as ClickHouse renders a `Date`. */
  day: string;
}

/** The erasure's reach into the daily cost rollup (ADR-128 §9 steps 3 and 5). */
export abstract class RollupErasureRepository {
  /** Every day that carries the actor, read before deleting: afterwards nothing can say. */
  abstract findDaysCarryingActor(input: {
    tenantIds: string[];
    rawActorId: string;
  }): Promise<ErasedRollupDay[]>;
  /** Deletes the actor's rollup rows; the caller replays the days to rebuild them. */
  abstract deleteRowsCarryingActor(input: {
    tenantIds: string[];
    rawActorId: string;
  }): Promise<void>;
  /** Overwrites the actor id in the restatement index, so a replay folds under the pseudonym. */
  abstract renameActorInRestatementIndex(input: {
    tenantIds: string[];
    rawActorId: string;
    pseudonymousActorId: string;
  }): Promise<void>;
}
