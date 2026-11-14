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

  async findOrganizationsWithEnded({ now }: { now: Instant }): Promise<string[]> {
    const ended = this.memory.seatHolds.filter(
      (hold) => Temporal.Instant.compare(hold.heldUntil, now) <= 0,
    );
    return [...new Set(ended.map((hold) => hold.organizationId))];
  }

  async deleteEnded({
    organizationId,
    now,
  }: {
    organizationId: string;
    now: Instant;
  }): Promise<void> {
    const kept = this.memory.seatHolds.filter(
      (hold) =>
        hold.organizationId !== organizationId || Temporal.Instant.compare(hold.heldUntil, now) > 0,
    );
    this.memory.seatHolds.splice(0, this.memory.seatHolds.length, ...kept);
  }

  #live({ organizationId, now }: { organizationId: string; now: Instant }): SeatHold[] {
    return this.memory.seatHolds.filter(
      (hold) =>
        hold.organizationId === organizationId && Temporal.Instant.compare(hold.heldUntil, now) > 0,
    );
  }
}
