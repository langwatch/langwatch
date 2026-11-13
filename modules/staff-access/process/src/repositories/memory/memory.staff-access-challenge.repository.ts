import { type Instant, Temporal } from "@langwatch/time";

import type {
  StaffAccessChallengeRepository,
  StaffAccessChallengeRow,
} from "../staff-access.repository.ts";

function isAfter(moment: Instant, at: Instant): boolean {
  return Temporal.Instant.compare(moment, at) > 0;
}

function newestFirst(a: { createdAt: Instant }, b: { createdAt: Instant }): number {
  return Temporal.Instant.compare(b.createdAt, a.createdAt);
}

export class MemoryStaffAccessChallengeRepository implements StaffAccessChallengeRepository {
  readonly #rows = new Map<string, StaffAccessChallengeRow>();

  static create(): MemoryStaffAccessChallengeRepository {
    return new MemoryStaffAccessChallengeRepository();
  }

  async create(row: StaffAccessChallengeRow): Promise<void> {
    this.#rows.set(row.id, row);
  }

  async findOpen({
    userId,
    purpose,
    at,
  }: {
    userId: string;
    purpose: string;
    at: Instant;
  }): Promise<StaffAccessChallengeRow[]> {
    return [...this.#rows.values()]
      .filter(
        (row) =>
          row.userId === userId &&
          row.purpose === purpose &&
          row.usedAt === null &&
          isAfter(row.expiresAt, at),
      )
      .toSorted(newestFirst)
      .slice(0, 5);
  }

  async claim({ id, at }: { id: string; at: Instant }): Promise<boolean> {
    const row = this.#rows.get(id);
    if (!row || row.usedAt !== null || !isAfter(row.expiresAt, at)) return false;
    this.#rows.set(id, { ...row, usedAt: at });
    return true;
  }
}
