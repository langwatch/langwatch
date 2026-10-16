import type { ClickHouseQueryClient } from "@langwatch/clickhouse-client";
import { z } from "zod";

import {
  CodingAgentSessionIndexMaterialisationRepository,
  sessionIdIndexMutationSchema,
  type SessionIdIndexMutation,
} from "../coding-agent-session-index-materialisation.repository.ts";

const mutationRowsSchema = z.array(
  z
    .object({
      mutationId: z.string(),
      isDone: z.number(),
      partsToDo: z.number(),
      latestFailReason: z.string(),
    })
    .transform((row) => sessionIdIndexMutationSchema.parse({ ...row, isDone: row.isDone === 1 })),
);

/** Reads and starts the `idx_session_id` mutation on the shared ClickHouse target. */
export class ClickHouseCodingAgentSessionIndexMaterialisationRepository extends CodingAgentSessionIndexMaterialisationRepository {
  readonly #clickhouse: ClickHouseQueryClient;

  private constructor(clickhouse: ClickHouseQueryClient) {
    super();
    this.#clickhouse = clickhouse;
  }

  static create(
    clickhouse: ClickHouseQueryClient,
  ): ClickHouseCodingAgentSessionIndexMaterialisationRepository {
    return new ClickHouseCodingAgentSessionIndexMaterialisationRepository(clickhouse);
  }

  async findSessionIdIndexMutations(): Promise<SessionIdIndexMutation[]> {
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
          AND table = 'coding_agent_sessions'
          AND position(command, 'MATERIALIZE INDEX idx_session_id') > 0
        ORDER BY create_time DESC
      `,
      // Materialising a skip index is a whole-table mutation on the shared target, which no tenant
      // owns.
      SKIP_TENANT_CHECK: true,
    });
    return mutationRowsSchema.parse(rows);
  }

  async materialiseSessionIdIndex(): Promise<void> {
    await this.#clickhouse.command({
      tenantId: "",
      table: "coding_agent_sessions",
      kind: "write",
      sql: "ALTER TABLE coding_agent_sessions MATERIALIZE INDEX IF EXISTS idx_session_id",
      // Materialising a skip index is a whole-table mutation on the shared target, which no tenant
      // owns.
      SKIP_TENANT_CHECK: true,
    });
  }
}
