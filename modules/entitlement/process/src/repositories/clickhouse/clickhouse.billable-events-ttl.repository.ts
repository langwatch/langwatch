import type { ClickHouseQueryClient } from "@langwatch/clickhouse-client";
import { z } from "zod";

import {
  BillableEventsTtlRepository,
  ttlMutationSchema,
  type TtlMutation,
} from "../billable-events-ttl.repository.ts";

const mutationRowsSchema = z.array(
  z
    .object({
      mutationId: z.string(),
      isDone: z.number(),
      partsToDo: z.number(),
      latestFailReason: z.string(),
    })
    .transform((row) => ttlMutationSchema.parse({ ...row, isDone: row.isDone === 1 })),
);

/** Reads and starts the `billable_events` TTL materialisation on the shared ClickHouse target. */
export class ClickHouseBillableEventsTtlRepository extends BillableEventsTtlRepository {
  readonly #clickhouse: ClickHouseQueryClient;

  private constructor(clickhouse: ClickHouseQueryClient) {
    super();
    this.#clickhouse = clickhouse;
  }

  static create(clickhouse: ClickHouseQueryClient): ClickHouseBillableEventsTtlRepository {
    return new ClickHouseBillableEventsTtlRepository(clickhouse);
  }

  async findTtlMutations(): Promise<TtlMutation[]> {
    const { rows } = await this.#clickhouse.query<unknown>({
      tenantId: "",
      table: "system.mutations",
      kind: "read",
      sql: `
        SELECT
          mutation_id AS mutationId,
          is_done AS isDone,
          toUInt32(parts_to_do) AS partsToDo,
          latest_fail_reason AS latestFailReason
        FROM system.mutations
        WHERE database = currentDatabase()
          AND table = 'billable_events'
          AND position(command, 'MATERIALIZE TTL') > 0
        ORDER BY create_time DESC
      `,
      // A TTL materialisation is a whole-table mutation on the shared target, which no tenant owns.
      SKIP_TENANT_CHECK: true,
    });
    return mutationRowsSchema.parse(rows);
  }

  async materialiseTtl(): Promise<void> {
    await this.#clickhouse.command({
      tenantId: "",
      table: "billable_events",
      kind: "write",
      sql: "ALTER TABLE billable_events MATERIALIZE TTL",
      // Applying the TTL to every part is a whole-table mutation on the shared target.
      SKIP_TENANT_CHECK: true,
    });
  }
}
