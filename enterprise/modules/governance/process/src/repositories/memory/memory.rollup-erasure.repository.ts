// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import { type ErasedRollupDay, RollupErasureRepository } from "../rollup-erasure.repository.ts";

/** One rollup or restatement-index row, as far as erasure can see it. */
export type MemoryRollupActorRow = { tenantId: string; day: string; rawActorId: string };

export class MemoryRollupErasureRepository extends RollupErasureRepository {
  readonly rollupRows: MemoryRollupActorRow[] = [];
  readonly restatementRows: MemoryRollupActorRow[] = [];

  private constructor() {
    super();
  }

  static create(): MemoryRollupErasureRepository {
    return new MemoryRollupErasureRepository();
  }

  async findDaysCarryingActor(input: {
    tenantIds: string[];
    rawActorId: string;
  }): Promise<ErasedRollupDay[]> {
    return input.tenantIds.flatMap((tenantId) =>
      [
        ...new Set(
          this.rollupRows
            .filter((row) => row.tenantId === tenantId && row.rawActorId === input.rawActorId)
            .map((row) => row.day),
        ),
      ]
        .toSorted()
        .map((day) => ({ tenantId, day })),
    );
  }

  async deleteRowsCarryingActor(input: { tenantIds: string[]; rawActorId: string }): Promise<void> {
    const kept = this.rollupRows.filter(
      (row) => !(input.tenantIds.includes(row.tenantId) && row.rawActorId === input.rawActorId),
    );
    this.rollupRows.splice(0, this.rollupRows.length, ...kept);
  }

  async renameActorInRestatementIndex(input: {
    tenantIds: string[];
    rawActorId: string;
    pseudonymousActorId: string;
  }): Promise<void> {
    for (const row of this.restatementRows) {
      if (input.tenantIds.includes(row.tenantId) && row.rawActorId === input.rawActorId) {
        row.rawActorId = input.pseudonymousActorId;
      }
    }
  }
}
