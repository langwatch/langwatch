import { type Instant, Temporal } from "@langwatch/time";

import { type SeatHold, SeatHoldRepository } from "../seat-hold.repository.ts";
import type { MemoryOrganizationDatabase } from "./memory.organization.database.ts";

/** Seat holds over the shared memory database the membership twin writes them into. */
export class MemorySeatHoldRepository extends SeatHoldRepository {
  static create(options: { memory: MemoryOrganizationDatabase }): MemorySeatHoldRepository {
    return new MemorySeatHoldRepository(options.memory);
  }

  private constructor(private readonly memory: MemoryOrganizationDatabase) {
    super();
  }

  async findLiveForPerson({
    organizationId,
    userId,
    email,
    now,
  }: {
    organizationId: string;
    userId?: string;
    email?: string;
    now: Instant;
  }): Promise<SeatHold[]> {
    const live = this.#live({ organizationId, now });
    const byUser = userId ? live.filter((hold) => hold.userId === userId) : [];
    const byEmail = email
      ? live.filter(
          (hold) => hold.email?.toLowerCase() === email.toLowerCase() && !byUser.includes(hold),
        )
      : [];
    return [...byUser, ...byEmail];
  }

  async findLiveInOrganization({
    organizationId,
    now,
  }: {
    organizationId: string;
    now: Instant;
  }): Promise<SeatHold[]> {
    return this.#live({ organizationId, now }).toSorted((a, b) =>
      Temporal.Instant.compare(a.heldUntil, b.heldUntil),
    );
  }

  async deleteEnded({ now }: { now: Instant }): Promise<string[]> {
    const isEnded = (hold: SeatHold) => Temporal.Instant.compare(hold.heldUntil, now) <= 0;
    const ended = this.memory.seatHolds.filter(isEnded);
    const kept = this.memory.seatHolds.filter((hold) => !isEnded(hold));
    this.memory.seatHolds.splice(0, this.memory.seatHolds.length, ...kept);
    return [...new Set(ended.map((hold) => hold.organizationId))];
  }

  #live({ organizationId, now }: { organizationId: string; now: Instant }): SeatHold[] {
    return this.memory.seatHolds.filter(
      (hold) =>
        hold.organizationId === organizationId && Temporal.Instant.compare(hold.heldUntil, now) > 0,
    );
  }
}
