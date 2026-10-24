import type { Authorization, CompiledWhere } from "@langwatch/authorization";

import type { BraidedSpanGroup } from "../rules/braided-trace-totals.rules.ts";
import type { TraceSpanSummaryRecord } from "./trace-projected-read.repository.ts";

/** A draft or saved braid's condition as one statement renders it (ADR-185 §7). */
export type BraidConditionRead = Readonly<{
  compiledWhere: CompiledWhere | undefined;
  readerProjectId: string;
}>;

/** One braid's window and condition, as an activity count reads it. */
export type BraidActivityRead = BraidConditionRead &
  Readonly<{ braidId: string; ownerProjectId: string; fromMs: number; untilMs: number }>;

/** One braid as a statement over the owner's spans reads it: its condition and its own window. */
export type BraidWindowRead = BraidConditionRead &
  Readonly<{ fromMs: number; untilMs: number | null }>;

/** Reader traces whose every or only some owner spans a set of braids shows, and those spans. */
export type BraidTraceCounts = Readonly<{ every: number; some: number; spans: number }>;

/**
 * The owner's spans over a set of reader traces: with the live braids and the draft together, with
 * the live braids alone, the spans only `Verified()` holds back, and the newest trace shown any.
 */
export type BraidOwnerTraceCounts = Readonly<{
  shown: BraidTraceCounts;
  live: BraidTraceCounts;
  unsigned: number;
  exampleTraceId: string | null;
}>;

export const NO_BRAID_TRACE_COUNTS: BraidOwnerTraceCounts = {
  shown: { every: 0, some: 0, spans: 0 },
  live: { every: 0, some: 0, spans: 0 },
  unsigned: 0,
  exampleTraceId: null,
};

/**
 * One project's spans in one trace, read through the reader's braided fence: one group per
 * project and price. `costInput` is set on a group whose spans carry no `gen_ai.usage.cost`.
 */
export type TraceSpanTotalsGroup = Readonly<BraidedSpanGroup>;

/**
 * The braid dialog's and the Braids page's reads (ADR-185 §7). Every statement reads one
 * project with that project's own proof; a second project is only ever a bound parameter.
 */
export abstract class TraceBraidReadsRepository {
  /** The reader's trace ids since `sinceMs`, newest first, at most `limit`. */
  abstract findReaderTraceIds(input: {
    authorization: Authorization;
    sinceMs: number;
    limit: number;
  }): Promise<string[]>;

  /** The owner's latest span versions in those traces, counted per trace in one statement. */
  abstract countOwnerSpansInTraces(input: {
    authorization: Authorization;
    traceIds: readonly string[];
    sinceMs: number;
    live: readonly BraidWindowRead[];
    draft: BraidWindowRead;
  }): Promise<BraidOwnerTraceCounts>;

  /** The owner's span attribute keys since `sinceMs`, most frequent first. */
  abstract findAttributeKeys(input: {
    authorization: Authorization;
    sinceMs: number;
    limit: number;
    excludedPrefix: string;
  }): Promise<{ key: string; spanCount: number }[]>;

  /** On the owner's page: its own spans since `sinceMs` matching each braid's condition, window. */
  abstract countOwnerBraidActivity(input: {
    authorization: Authorization;
    braids: readonly BraidActivityRead[];
    sinceMs: number;
  }): Promise<Map<string, number>>;

  /** On the reader's page: the braided spans its proof lets through since `sinceMs`, per braid. */
  abstract countReaderBraidActivity(input: {
    authorization: Authorization;
    braids: readonly BraidActivityRead[];
    sinceMs: number;
  }): Promise<Map<string, number>>;

  /** On the reader's trace header: the latest version of each span its proof lets through. */
  abstract sumSpansInTrace(input: {
    authorization: Authorization;
    traceId: string;
    occurredAtMs?: number | undefined;
  }): Promise<TraceSpanTotalsGroup[]>;

  /** The owner's latest span versions in one trace, each marked if any of the braids passes it. */
  abstract findOwnerSpansMarked(input: {
    authorization: Authorization;
    traceId: string;
    braids: readonly BraidWindowRead[];
  }): Promise<(TraceSpanSummaryRecord & { braided: boolean })[]>;
}

/** Reads nothing: the composition without ClickHouse answers every braid read empty. */
export class EmptyTraceBraidReadsRepository extends TraceBraidReadsRepository {
  static create(): EmptyTraceBraidReadsRepository {
    return new EmptyTraceBraidReadsRepository();
  }

  findReaderTraceIds(): Promise<string[]> {
    return Promise.resolve([]);
  }

  countOwnerSpansInTraces(): Promise<BraidOwnerTraceCounts> {
    return Promise.resolve(NO_BRAID_TRACE_COUNTS);
  }

  findAttributeKeys(): Promise<{ key: string; spanCount: number }[]> {
    return Promise.resolve([]);
  }

  countOwnerBraidActivity(): Promise<Map<string, number>> {
    return Promise.resolve(new Map());
  }

  countReaderBraidActivity(): Promise<Map<string, number>> {
    return Promise.resolve(new Map());
  }

  sumSpansInTrace(): Promise<TraceSpanTotalsGroup[]> {
    return Promise.resolve([]);
  }

  findOwnerSpansMarked(): Promise<(TraceSpanSummaryRecord & { braided: boolean })[]> {
    return Promise.resolve([]);
  }
}
