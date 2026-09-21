/**
 * Judgements held in process, keyed and ordered exactly as the table is, so a
 * test pages them the same way a caller does.
 */

import { type Instant, Temporal } from "@langwatch/time";

import {
  decodeInstantEvalCursor,
  encodeInstantEvalCursor,
  parseProbabilities,
} from "../clickhouse/clickhouse.instant-eval-judgments.mapper.ts";
import type {
  InstantEvalJudgment,
  InstantEvalJudgmentPage,
  InstantEvalJudgmentQuery,
  InstantEvalJudgmentRecord,
  InstantEvalJudgmentSampleQuery,
  InstantEvalJudgmentsRepository,
} from "../instant-eval-judgments.repository.ts";

/** The key separator: a run, trace, span and question id never carry a pipe. */
const KEY_SEPARATOR = "|";

type StoredJudgment = InstantEvalJudgment & {
  readonly projectId: string;
  readonly runId: string;
  readonly createdAt: number;
};

export class MemoryInstantEvalJudgmentsRepository implements InstantEvalJudgmentsRepository {
  private readonly records = new Map<string, StoredJudgment>();

  private constructor() {}

  static create(): MemoryInstantEvalJudgmentsRepository {
    return new MemoryInstantEvalJudgmentsRepository();
  }

  async insert(records: readonly InstantEvalJudgmentRecord[]): Promise<void> {
    for (const record of records) {
      this.records.set(keyOf(record), {
        projectId: record.TenantId,
        runId: record.RunId,
        createdAt: record.CreatedAt,
        traceId: record.TraceId,
        questionId: record.QuestionId,
        threadId: record.ThreadId,
        spanId: record.SpanId,
        kind: record.Kind,
        status: record.Status,
        passed: record.Passed === null ? null : record.Passed === 1,
        score: record.Score,
        label: record.Label === "" ? null : record.Label,
        probability: record.Probability,
        probabilities: parseProbabilities(record.Probabilities),
        error: record.Error === "" ? null : record.Error,
        occurredAt: Temporal.Instant.fromEpochMilliseconds(record.OccurredAt).toString(),
      });
    }
  }

  async getPage(query: InstantEvalJudgmentQuery): Promise<InstantEvalJudgmentPage> {
    const cursor = query.cursor === undefined ? null : decodeInstantEvalCursor(query.cursor);
    const matching = this.within(query)
      .filter((row) => query.questionId === undefined || row.questionId === query.questionId)
      .filter((row) => query.traceIds === undefined || query.traceIds.includes(row.traceId))
      .filter((row) => query.status === undefined || row.status === query.status)
      .filter((row) => query.matched === undefined || isMatched(row) === query.matched)
      .filter((row) => cursor === null || sortKey(row) > sortKey(cursor))
      .toSorted((left, right) => sortKey(left).localeCompare(sortKey(right)));

    const page = matching.slice(0, query.limit);
    const last = page.at(-1);
    return {
      judgments: page.map(published),
      ...(matching.length > query.limit && last
        ? { nextCursor: encodeInstantEvalCursor(last) }
        : {}),
    };
  }

  async findSample(query: InstantEvalJudgmentSampleQuery): Promise<readonly InstantEvalJudgment[]> {
    const rows = this.within(query);
    const traces = [...new Set(rows.map((row) => row.traceId))]
      .toSorted((left, right) => hashOf(left, query.seed) - hashOf(right, query.seed))
      .slice(0, query.traces);
    return rows
      .filter((row) => traces.includes(row.traceId))
      .toSorted((left, right) => sortKey(left).localeCompare(sortKey(right)))
      .map(published);
  }

  private within(query: {
    projectId: string;
    runId: string;
    writtenFrom: Instant;
    writtenUntil: Instant;
  }): StoredJudgment[] {
    return [...this.records.values()].filter(
      (row) =>
        row.projectId === query.projectId &&
        row.runId === query.runId &&
        row.createdAt >= query.writtenFrom.epochMilliseconds &&
        row.createdAt <= query.writtenUntil.epochMilliseconds,
    );
  }
}

function keyOf(record: InstantEvalJudgmentRecord): string {
  return [record.TenantId, record.RunId, record.TraceId, record.SpanId, record.QuestionId].join(
    KEY_SEPARATOR,
  );
}

function sortKey(row: { traceId: string; spanId: string; questionId: string }): string {
  return [row.traceId, row.spanId, row.questionId].join(KEY_SEPARATOR);
}

/** A match is a boolean question that passed; another kind's is a judged row. */
function isMatched(row: StoredJudgment): boolean {
  return row.passed === true || (row.kind !== "boolean" && row.status === "judged");
}

/** A stable per-seed shuffle, standing in for the query's `cityHash64`. */
function hashOf(value: string, seed: number): number {
  let hash = seed >>> 0;
  for (const character of value) {
    hash = Math.imul(hash ^ character.codePointAt(0)!, 16_777_619) >>> 0;
  }
  return hash;
}

function published(row: StoredJudgment): InstantEvalJudgment {
  const { projectId: _projectId, runId: _runId, createdAt: _createdAt, ...judgment } = row;
  return judgment;
}
