import type { Authorization, CompiledWhere } from "@langwatch/authorization";

import type { TraceSpanSummaryRecord } from "./trace-projected-read.repository.ts";

/** A draft or saved braid's condition as one statement renders it (ADR-183 §7). */
export type BraidConditionRead = Readonly<{
  compiledWhere: CompiledWhere | undefined;
  readerProjectId: string;
}>;

/** One braid's window and condition, as an activity count reads it. */
export type BraidActivityRead = BraidConditionRead &
  Readonly<{ braidId: string; ownerProjectId: string; fromMs: number; untilMs: number }>;

/** The owner's spans over a set of reader traces: traces whose every or only some spans match. */
export type BraidOwnerTraceCounts = Readonly<{ every: number; some: number; unsigned: number }>;

/**
 * The braid dialog's and the Braids page's reads (ADR-183 §7). Every statement reads one
 * project with that project's own proof; a second project is only ever a bound parameter.
 */
export abstract class TraceBraidReadsRepository {
  /** The reader's trace ids since `sinceMs`, newest first, at most `limit`. */
  abstract findReaderTraceIds(input: {
    authorization: Authorization;
    sinceMs: number;
    limit: number;
  }): Promise<string[]>;

  /** The owner's latest span versions in those traces, counted per trace against the condition. */
  abstract countOwnerSpansInTraces(input: {
    authorization: Authorization;
    traceIds: readonly string[];
    sinceMs: number;
    fromMs: number;
    condition: BraidConditionRead;
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

  /** The owner's latest span versions in one trace, each marked if the draft braid passes it. */
  abstract findOwnerSpansMarked(input: {
    authorization: Authorization;
    traceId: string;
    fromMs: number;
    condition: BraidConditionRead;
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
    return Promise.resolve({ every: 0, some: 0, unsigned: 0 });
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

  findOwnerSpansMarked(): Promise<(TraceSpanSummaryRecord & { braided: boolean })[]> {
    return Promise.resolve([]);
  }
}
