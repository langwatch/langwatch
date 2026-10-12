import { z } from "zod";
import type { ClickHouseClientResolver } from "~/server/clickhouse/clickhouseClient";
import type { InstantEvalProcessingBlock } from "./processing-block";

export interface InstantEvalInterruptionReceipt {
  readonly projectId: string;
  readonly runId: string;
  readonly componentType: "command" | "projection";
  readonly componentName: string;
  /** Command phase/page identity, or the refused projection event id. */
  readonly operationKey: string;
  readonly observedAtMs: number;
}

export interface InstantEvalRunInterruptionsRepository {
  record(receipts: readonly InstantEvalInterruptionReceipt[]): Promise<void>;
  blocksForRuns(input: {
    projectId: string;
    runIds: readonly string[];
  }): Promise<Record<string, InstantEvalProcessingBlock>>;
}

const interruptionSchema = z.object({
  RunId: z.string(),
  ComponentType: z.enum(["command", "projection"]),
  ComponentName: z.string(),
  ObservedAtMs: z.coerce.number().finite(),
});

/** Append-only evidence outside the status projection it describes. No query,
 * text or payload is stored. Tenant resolution and filtering are both required.
 */
export class ClickHouseInstantEvalRunInterruptionsRepository
  implements InstantEvalRunInterruptionsRepository
{
  constructor(private readonly resolveClient: ClickHouseClientResolver) {}

  async record(
    receipts: readonly InstantEvalInterruptionReceipt[],
  ): Promise<void> {
    const tenants = new Map<string, InstantEvalInterruptionReceipt[]>();
    for (const receipt of receipts) {
      const rows = tenants.get(receipt.projectId) ?? [];
      rows.push(receipt);
      tenants.set(receipt.projectId, rows);
    }
    for (const [projectId, rows] of tenants) {
      const client = await this.resolveClient(projectId);
      await client.insert({
        table: "instant_eval_run_interruptions",
        values: rows.map((row) => ({
          TenantId: row.projectId,
          RunId: row.runId,
          ComponentType: row.componentType,
          ComponentName: row.componentName,
          OperationKey: row.operationKey,
          ObservedAt: new Date(row.observedAtMs),
        })),
        format: "JSONEachRow",
        clickhouse_settings: { async_insert: 1, wait_for_async_insert: 1 },
      });
    }
  }

  async blocksForRuns({
    projectId,
    runIds,
  }: {
    projectId: string;
    runIds: readonly string[];
  }): Promise<Record<string, InstantEvalProcessingBlock>> {
    if (runIds.length === 0) return {};
    const client = await this.resolveClient(projectId);
    const result = await client.query({
      // Read-time grouping deduplicates at-least-once receipts, including before
      // any background merge. IDs/stages are lightweight; no payload columns.
      query: `SELECT RunId, ComponentType, ComponentName,
        toUnixTimestamp64Milli(min(ObservedAt)) AS ObservedAtMs
        FROM instant_eval_run_interruptions
        WHERE TenantId = {tenantId:String} AND RunId IN {runIds:Array(String)}
        GROUP BY RunId, ComponentType, ComponentName
        ORDER BY RunId, ComponentType, ComponentName`,
      query_params: { tenantId: projectId, runIds: [...runIds] },
      format: "JSONEachRow",
    });
    const rows = z.array(interruptionSchema).parse(await result.json());
    const blocks: Record<string, InstantEvalProcessingBlock> = {};
    for (const row of rows) {
      const previous = blocks[row.RunId];
      blocks[row.RunId] = {
        code: "instant_eval_processing_disabled",
        observedAtMs: Math.min(
          previous?.observedAtMs ?? row.ObservedAtMs,
          row.ObservedAtMs,
        ),
        stages: [
          ...(previous?.stages ?? []),
          {
            componentType: row.ComponentType,
            componentName: row.ComponentName,
          },
        ],
      };
    }
    return blocks;
  }
}
