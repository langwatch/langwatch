import {
  analyticsEvaluationReadInputSchema,
  analyticsEvaluationRollupAppendBatchInputSchema,
  analyticsEvaluationRollupAppendInputSchema,
  analyticsEvaluationUpsertBatchInputSchema,
  analyticsEvaluationUpsertInputSchema,
  type AnalyticsEvaluationReadInput,
  type AnalyticsEvaluationRollupAppendBatchInput,
  type AnalyticsEvaluationRollupAppendInput,
  type AnalyticsEvaluationRow,
  type AnalyticsEvaluationUpsertInput,
} from "@langwatch/analytics-contract";
import { EventUtils, SecurityError } from "@langwatch/eventing";

import { AnalyticsEvaluationRepository } from "../analytics-persistence.repository.ts";

type StoredEvaluation = Readonly<{ row: AnalyticsEvaluationRow; appliedEventIds: string[] }>;

/**
 * The evaluation slim table in this process's memory, read as after a merge: per tenant and
 * evaluation, the versions sharing the newest `updatedAtMs`, as `ReplacingMergeTree(UpdatedAt)`.
 */
export type MemoryEvaluationAnalyticsTable = Map<string, Map<string, StoredEvaluation[]>>;

/** ClickHouse sorts a NULL last in either direction, so it never wins a DESC tiebreak. */
const descending = (left: number | null, right: number | null): number =>
  (right ?? -Infinity) - (left ?? -Infinity);

function readOrder(left: StoredEvaluation, right: StoredEvaluation): number {
  return (
    descending(left.row.occurredAtMs, right.row.occurredAtMs) ||
    descending(left.row.completedAtMs, right.row.completedAtMs) ||
    descending(left.row.startedAtMs, right.row.startedAtMs) ||
    right.appliedEventIds.length - left.appliedEventIds.length
  );
}

/** The evaluation tables' memory twin: slim rows read back as the live query reads them. */
export class MemoryAnalyticsEvaluationRepository extends AnalyticsEvaluationRepository {
  static create({
    table,
  }: Readonly<{ table: MemoryEvaluationAnalyticsTable }>): MemoryAnalyticsEvaluationRepository {
    return new MemoryAnalyticsEvaluationRepository(table);
  }

  readonly #table: MemoryEvaluationAnalyticsTable;

  private constructor(table: MemoryEvaluationAnalyticsTable) {
    super();
    this.#table = table;
  }

  async upsert(input: AnalyticsEvaluationUpsertInput): Promise<void> {
    const parsed = analyticsEvaluationUpsertInputSchema.parse(input);
    validateTenant(parsed.row.tenantId, "upsert");
    this.#keep(parsed.row.tenantId, [parsed]);
  }

  async upsertBatch(input: AnalyticsEvaluationUpsertInput[]): Promise<void> {
    const entries = analyticsEvaluationUpsertBatchInputSchema.parse(input);
    const tenantId = entries[0]?.row.tenantId;
    if (tenantId === undefined) return;

    validateTenant(tenantId, "upsertBatch");
    refuseMixedTenants({ tenantId, rows: entries.map(({ row }) => row), operation: "upsertBatch" });
    this.#keep(tenantId, entries);
  }

  async findLatest(
    input: AnalyticsEvaluationReadInput,
  ): Promise<{ row: AnalyticsEvaluationRow; appliedEventIds: string[] }[]> {
    const parsed = analyticsEvaluationReadInputSchema.parse(input);
    validateTenant(parsed.tenantId, "findLatest");
    const { window } = parsed;
    const [latest] = (this.#table.get(parsed.tenantId)?.get(parsed.evaluationId) ?? [])
      .filter(
        ({ row }) =>
          !window || (row.occurredAtMs >= window.fromMs && row.occurredAtMs <= window.toMs),
      )
      .toSorted(readOrder);
    return latest ? [{ row: { ...latest.row }, appliedEventIds: [...latest.appliedEventIds] }] : [];
  }

  /** No memory read answers from the rollup table, so an append is checked and kept nowhere. */
  async appendRollup(input: AnalyticsEvaluationRollupAppendInput): Promise<void> {
    const parsed = analyticsEvaluationRollupAppendInputSchema.parse(input);
    validateTenant(parsed.row.tenantId, "appendRollup");
  }

  async appendRollupBatch(input: AnalyticsEvaluationRollupAppendBatchInput): Promise<void> {
    const parsed = analyticsEvaluationRollupAppendBatchInputSchema.parse(input);
    const tenantId = parsed.rows[0]?.tenantId;
    if (tenantId === undefined) return;

    validateTenant(tenantId, "appendRollupBatch");
    refuseMixedTenants({ tenantId, rows: parsed.rows, operation: "appendRollupBatch" });
  }

  #keep(
    tenantId: string,
    entries: readonly Readonly<{ row: AnalyticsEvaluationRow; appliedEventIds?: string[] }>[],
  ): void {
    const evaluations = this.#table.get(tenantId) ?? new Map<string, StoredEvaluation[]>();
    for (const { row, appliedEventIds } of entries) {
      const stored = { row: { ...row }, appliedEventIds: [...(appliedEventIds ?? [])] };
      const versions = evaluations.get(row.evaluationId) ?? [];
      const newest = versions[0]?.row.updatedAtMs ?? -Infinity;
      if (row.updatedAtMs > newest) evaluations.set(row.evaluationId, [stored]);
      else if (row.updatedAtMs === newest) versions.push(stored);
    }
    this.#table.set(tenantId, evaluations);
  }
}

function validateTenant(tenantId: string, operation: string): void {
  EventUtils.validateTenantId({ tenantId }, `AnalyticsEvaluationRepository.${operation}`);
}

function refuseMixedTenants({
  tenantId,
  rows,
  operation,
}: Readonly<{ tenantId: string; rows: readonly { tenantId: string }[]; operation: string }>): void {
  const mismatched = rows.find((row) => row.tenantId !== tenantId);
  if (!mismatched) return;

  throw new SecurityError({
    operation: `AnalyticsEvaluationRepository.${operation}`,
    message: "all rows in a single batch must share one tenantId",
    tenantId,
    context: { mismatchedTenantId: mismatched.tenantId },
  });
}
