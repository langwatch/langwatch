// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import { generate } from "@langwatch/ksuid";
import { nowInstant, type Instant } from "@langwatch/time";

import {
  BlockedSeatChangeRepository,
  type BlockedSeatChange,
} from "../blocked-seat-change.repository.ts";

/** The refused seat changes in memory; `rows` is the test's view of what was kept. */
export class MemoryBlockedSeatChangeRepository extends BlockedSeatChangeRepository {
  readonly rows: (BlockedSeatChange & { notifiedAt: Instant | null })[] = [];

  static create(): MemoryBlockedSeatChangeRepository {
    return new MemoryBlockedSeatChangeRepository();
  }

  private constructor() {
    super();
  }

  async record(input: Parameters<BlockedSeatChangeRepository["record"]>[0]): Promise<void> {
    this.rows.push({
      id: generate("bsc").toString(),
      ...input,
      createdAt: nowInstant(),
      notifiedAt: null,
    });
  }

  async findWaiting(): Promise<BlockedSeatChange[]> {
    return this.rows
      .filter((row) => row.notifiedAt === null)
      .toSorted((a, b) => a.createdAt.epochMilliseconds - b.createdAt.epochMilliseconds)
      .map(({ notifiedAt: _notifiedAt, ...row }) => row);
  }

  async findWaitingFor(
    input: Parameters<BlockedSeatChangeRepository["findWaitingFor"]>[0],
  ): Promise<BlockedSeatChange[]> {
    return (await this.findWaiting()).filter(
      (row) => row.organizationId === input.organizationId && row.userId === input.userId,
    );
  }

  async markNotified(
    input: Parameters<BlockedSeatChangeRepository["markNotified"]>[0],
  ): Promise<void> {
    for (const row of this.rows) {
      if (
        row.organizationId === input.organizationId &&
        row.userId === input.userId &&
        row.createdAt.epochMilliseconds <= input.createdUpTo.epochMilliseconds &&
        row.notifiedAt === null
      ) {
        row.notifiedAt = input.at;
      }
    }
  }
}
