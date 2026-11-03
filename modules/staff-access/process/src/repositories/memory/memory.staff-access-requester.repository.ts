import { type Instant, Temporal } from "@langwatch/time";

import type {
  StaffAccessRequesterRepository,
  StaffAccessRequesterRow,
} from "../staff-access.repository.ts";

function newestFirst(a: { createdAt: Instant }, b: { createdAt: Instant }): number {
  return Temporal.Instant.compare(b.createdAt, a.createdAt);
}

export class MemoryStaffAccessRequesterRepository implements StaffAccessRequesterRepository {
  readonly #rows = new Map<string, StaffAccessRequesterRow>();

  static create(): MemoryStaffAccessRequesterRepository {
    return new MemoryStaffAccessRequesterRepository();
  }

  async create(row: StaffAccessRequesterRow): Promise<void> {
    this.#rows.set(row.id, row);
  }

  async findByLookupId({ lookupId }: { lookupId: string }): Promise<StaffAccessRequesterRow[]> {
    return [...this.#rows.values()].filter((row) => row.lookupId === lookupId);
  }

  async findById({ id }: { id: string }): Promise<StaffAccessRequesterRow[]> {
    const row = this.#rows.get(id);
    return row ? [row] : [];
  }

  async findByOwner({ ownerUserId }: { ownerUserId: string }): Promise<StaffAccessRequesterRow[]> {
    return [...this.#rows.values()]
      .filter((row) => row.ownerUserId === ownerUserId)
      .toSorted(newestFirst);
  }

  async touch({ id, at }: { id: string; at: Instant }): Promise<void> {
    const row = this.#rows.get(id);
    if (row) this.#rows.set(id, { ...row, lastUsedAt: at });
  }

  async revoke({
    id,
    ownerUserId,
    at,
  }: {
    id: string;
    ownerUserId: string;
    at: Instant;
  }): Promise<boolean> {
    const row = this.#rows.get(id);
    if (!row || row.ownerUserId !== ownerUserId || row.revokedAt) return false;
    this.#rows.set(id, { ...row, revokedAt: at });
    return true;
  }
}
