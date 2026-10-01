/**
 * One process's own budget holds: the same contract the Redis store keeps,
 * for a suite and for a deployment with no Redis, where the view is this
 * pod's alone.
 */

import { nowInstant, type Instant } from "@langwatch/time";

import type {
  InstantEvalBudgetReservationOutcome,
  InstantEvalBudgetReservationsChannel,
} from "../instant-eval-budget-reservations.channel.ts";

interface HeldReservation {
  readonly nanoUsd: number;
  readonly expiresAt: number;
}

export class MemoryInstantEvalBudgetReservationsChannel implements InstantEvalBudgetReservationsChannel {
  readonly #held = new Map<string, Map<string, HeldReservation>>();

  private constructor(private readonly now: () => Instant) {}

  /** `now` is injected so a suite can drive a lapse without sleeping. */
  static create(options: { now?: () => Instant } = {}): MemoryInstantEvalBudgetReservationsChannel {
    return new MemoryInstantEvalBudgetReservationsChannel(options.now ?? nowInstant);
  }

  async reserve({
    organizationId,
    reservationId,
    nanoUsd,
    limitNanoUsd,
    ttlMs,
  }: {
    organizationId: string;
    reservationId: string;
    nanoUsd: number;
    limitNanoUsd: number;
    ttlMs: number;
  }): Promise<InstantEvalBudgetReservationOutcome> {
    const live = this.#live(organizationId);
    const others = sumExcept({ live, except: reservationId });
    if (others + nanoUsd > limitNanoUsd) {
      return { isReserved: false, heldNanoUsd: others };
    }

    live.set(reservationId, {
      nanoUsd,
      expiresAt: this.now().epochMilliseconds + ttlMs,
    });

    return { isReserved: true, heldNanoUsd: others + nanoUsd };
  }

  async release({
    organizationId,
    reservationId,
  }: {
    organizationId: string;
    reservationId: string;
  }): Promise<void> {
    this.#held.get(organizationId)?.delete(reservationId);
  }

  async heldNanoUsd({
    organizationId,
    except,
  }: {
    organizationId: string;
    except?: string;
  }): Promise<number> {
    return sumExcept({ live: this.#live(organizationId), except });
  }

  /** The organization's reservations with the lapsed ones dropped. */
  #live(organizationId: string): Map<string, HeldReservation> {
    let reservations = this.#held.get(organizationId);
    if (!reservations) {
      reservations = new Map();
      this.#held.set(organizationId, reservations);
    }

    const now = this.now().epochMilliseconds;
    for (const [id, reservation] of reservations) {
      if (reservation.expiresAt <= now) reservations.delete(id);
    }

    return reservations;
  }
}

function sumExcept({
  live,
  except,
}: {
  live: ReadonlyMap<string, HeldReservation>;
  except: string | undefined;
}): number {
  let total = 0;
  for (const [id, reservation] of live) {
    if (id !== except) total += reservation.nanoUsd;
  }

  return total;
}
