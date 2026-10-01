import type { Instant } from "@langwatch/time";

/** One confirmed dispatch of one trigger; an outbox retry presents the same `dedupKey`. */
export type PersistCapSlotRef = {
  projectId: string;
  triggerId: string;
  now: Instant;
  dedupKey: string;
};

/**
 * What consuming a slot counted. `degraded` is a shared store that could not be reached: the
 * count is this worker's own, so the ceiling holds per worker until the store recovers.
 */
export type PersistCapSlotCount =
  | Readonly<{ outcome: "counted"; count: number }>
  | Readonly<{ outcome: "degraded"; count: number }>;

export type PersistCapTriggerCount = Readonly<{ triggerId: string; count: number }>;

/** Today's confirmed-dispatch counter per trigger, claimed idempotently per dispatch. */
export abstract class AutomationPersistCapRepository {
  abstract consumeSlot(slot: PersistCapSlotRef): Promise<PersistCapSlotCount>;

  /** Every requested trigger, zero when it has counted nothing today. Never consumes a slot. */
  abstract findCounts(input: {
    projectId: string;
    triggerIds: readonly string[];
    now: Instant;
  }): Promise<PersistCapTriggerCount[]>;
}
