/**
 * Instant Evals results held in process, deduplicated on the table's sort key the way the
 * replacing merge does, and recalled by the same pick, so a test sees what a caller would.
 */

import { evalResultsMatchKeyId } from "../../rules/eval-results-key.rules.ts";
import { pickLatestEvalResult } from "../../rules/eval-results-recall.rules.ts";
import { latestTraceEvalResults } from "../../rules/eval-results-trace.rules.ts";
import { parseProbabilities } from "../clickhouse/clickhouse.instant-eval-judgments.mapper.ts";
import type {
  EvalResultRecord,
  EvalResultsRecallQuery,
  EvalResultsRepository,
  EvalResultsTraceQuery,
  EvalTraceResult,
  RecalledEvalResult,
} from "../eval-results.repository.ts";

export class MemoryEvalResultsRepository implements EvalResultsRepository {
  private readonly records = new Map<string, EvalResultRecord>();

  private constructor() {}

  static create(): MemoryEvalResultsRepository {
    return new MemoryEvalResultsRepository();
  }

  /** Every row kept, latest version per sort key, for a test to read what was written. */
  list(): readonly EvalResultRecord[] {
    return [...this.records.values()];
  }

  async insert(records: readonly EvalResultRecord[]): Promise<void> {
    for (const record of records) {
      const key = sortKeyOf(record);
      const current = this.records.get(key);
      if (!current || record.UpdatedAt >= current.UpdatedAt) this.records.set(key, record);
    }
  }

  async findLatestJudged(query: EvalResultsRecallQuery): Promise<readonly RecalledEvalResult[]> {
    const wanted = new Set(query.keys.map(evalResultsMatchKeyId));
    const byKey = new Map<string, RecalledEvalResult[]>();
    for (const record of this.records.values()) {
      const recalled = recalledOf(record);
      const key = evalResultsMatchKeyId(recalled);
      const isMatch =
        record.TenantId === query.tenantId &&
        record.JudgeModel === query.judgeModel &&
        record.KeyVersion === query.keyVersion &&
        record.Status === "judged" &&
        record.OccurredAt >= query.occurredFrom &&
        record.OccurredAt <= query.occurredUntil &&
        wanted.has(key);
      if (!isMatch) continue;
      const rows = byKey.get(key);
      if (rows) rows.push(recalled);
      else byKey.set(key, [recalled]);
    }
    return [...byKey.values()].flatMap((rows) => pickLatestEvalResult(rows));
  }

  async findLatestByTrace(query: EvalResultsTraceQuery): Promise<readonly EvalTraceResult[]> {
    const rows = [...this.records.values()].filter(
      (record) =>
        record.TenantId === query.tenantId &&
        record.TraceId === query.traceId &&
        record.KeyVersion === query.keyVersion &&
        record.OccurredAt >= query.occurredFrom &&
        record.OccurredAt <= query.occurredUntil,
    );
    return latestTraceEvalResults(rows.map(traceResultOf));
  }

  async countJudged({
    projectIds,
    since,
  }: {
    projectIds: readonly string[];
    since?: number;
  }): Promise<number> {
    return [...this.records.values()].filter(
      (record) =>
        projectIds.includes(record.TenantId) &&
        record.Status === "judged" &&
        (since === undefined || record.JudgedAt >= since),
    ).length;
  }
}

/** The table's sort key; JSON, so no id holding a separator can collide. */
function sortKeyOf(record: EvalResultRecord): string {
  return JSON.stringify([
    record.TenantId,
    record.TraceId,
    record.SpanId,
    record.QuestionHash,
    record.JudgeModel,
    record.InputHash,
    record.JudgedColumn,
    record.SourceId,
    record.JudgedAt,
  ]);
}

function recalledOf(record: EvalResultRecord): RecalledEvalResult {
  return {
    traceId: record.TraceId,
    spanId: record.SpanId,
    questionHash: record.QuestionHash,
    inputHash: record.InputHash,
    sourceId: record.SourceId,
    score: record.Score,
    label: record.Label === "" ? null : record.Label,
    probability: record.Probability,
    probabilities: parseProbabilities(record.Probabilities),
    judgedAt: record.JudgedAt,
    updatedAt: record.UpdatedAt,
  };
}

function traceResultOf(record: EvalResultRecord): EvalTraceResult {
  return {
    spanId: record.SpanId,
    questionHash: record.QuestionHash,
    judgedColumn: record.JudgedColumn,
    question: record.Question,
    kind: record.Kind,
    status: record.Status,
    probability: record.Probability,
    score: record.Score,
    label: record.Label === "" ? null : record.Label,
    judgeModel: record.JudgeModel,
    source: record.Source,
    sourceId: record.SourceId,
    judgedAt: record.JudgedAt,
    updatedAt: record.UpdatedAt,
  };
}
