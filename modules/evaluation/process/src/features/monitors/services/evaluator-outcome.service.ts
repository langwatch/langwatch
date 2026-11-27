/** Staff investigation counts of online evaluator runs; ids, counts, codes and times only. */
import {
  EVALUATOR_TYPE_USAGE_MAX_TYPES,
  evaluatorOutcomeCountQuerySchema,
  evaluatorTypeUsageQuerySchema,
  type EvaluatorOutcomeCount,
  type EvaluatorOutcomeCountQuery,
  type EvaluatorTypeUsage,
  type EvaluatorTypeUsageQuery,
} from "@langwatch/evaluation-contract";

import type {
  EvaluatorOutcomeRow,
  MonitorPerformanceRepository,
} from "../../../repositories/monitor-performance.repository.ts";

/** Rows (evaluator by error code) one project's read returns at most. */
const OUTCOME_ROWS_PER_PROJECT = 2000;

export class EvaluatorOutcomeService {
  static create(options: { repository: MonitorPerformanceRepository }): EvaluatorOutcomeService {
    return new EvaluatorOutcomeService(options.repository);
  }

  private constructor(private readonly repository: MonitorPerformanceRepository) {}

  /** One tenant-scoped read per project; evaluators sorted by id within each project. */
  async countEvaluatorOutcomes(
    input: EvaluatorOutcomeCountQuery,
  ): Promise<EvaluatorOutcomeCount[]> {
    const query = evaluatorOutcomeCountQuerySchema.parse(input);
    if (query.until <= query.since) return [];
    const projectIds = [...new Set(query.projectIds)];
    const counts: EvaluatorOutcomeCount[] = [];
    for (const projectId of projectIds) {
      const rows = await this.repository.findOutcomeRows({
        tenantId: projectId,
        since: query.since,
        until: query.until,
        limit: OUTCOME_ROWS_PER_PROJECT,
      });
      counts.push(...foldOutcomeRows({ projectId, rows }));
    }
    return counts;
  }

  /** One read over every tenant; each type's error codes busiest first. */
  async countEvaluatorUsageByType(input: EvaluatorTypeUsageQuery): Promise<EvaluatorTypeUsage[]> {
    const query = evaluatorTypeUsageQuerySchema.parse(input);
    if (query.until <= query.since) return [];
    const rows = await this.repository.findTypeUsageRows({
      since: query.since,
      until: query.until,
      limit: EVALUATOR_TYPE_USAGE_MAX_TYPES,
    });
    return rows.map((row) => ({
      evaluatorType: row.evaluatorType,
      projects: row.projects,
      runs: row.runs,
      errors: row.errors,
      skipped: row.skipped,
      errorsByCode: Object.entries(row.errorsByCode)
        .map(([code, count]) => ({ code, count }))
        .toSorted((left, right) => right.count - left.count || left.code.localeCompare(right.code)),
    }));
  }
}

function foldOutcomeRows({
  projectId,
  rows,
}: {
  projectId: string;
  rows: EvaluatorOutcomeRow[];
}): EvaluatorOutcomeCount[] {
  const byEvaluator = new Map<string, EvaluatorOutcomeCount>();
  for (const row of rows) {
    const count = byEvaluator.get(row.evaluatorId) ?? {
      projectId,
      evaluatorId: row.evaluatorId,
      evaluatorType: row.evaluatorType,
      runs: 0,
      errors: 0,
      skipped: 0,
      errorsByCode: [],
      lastErrorAt: null,
    };
    count.runs += row.runs;
    count.errors += row.errors;
    count.skipped += row.skipped;
    if (row.errorCode !== "" && row.errors > 0) {
      count.errorsByCode.push({ code: row.errorCode, count: row.errors });
    }
    if (row.lastErrorAt !== null) {
      count.lastErrorAt = Math.max(count.lastErrorAt ?? 0, row.lastErrorAt);
    }
    byEvaluator.set(row.evaluatorId, count);
  }
  return [...byEvaluator.values()]
    .map((count) => ({
      ...count,
      errorsByCode: count.errorsByCode.toSorted(
        (left, right) => right.count - left.count || left.code.localeCompare(right.code),
      ),
    }))
    .toSorted((left, right) => left.evaluatorId.localeCompare(right.evaluatorId));
}
