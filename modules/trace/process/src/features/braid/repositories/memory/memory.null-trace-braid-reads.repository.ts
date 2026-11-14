import type { TraceSpanSummaryRecord } from "../../../../repositories/trace-projected-read.repository.ts";
import {
  type BraidOwnerTraceCounts,
  NO_BRAID_TRACE_COUNTS,
  TraceBraidReadsRepository,
  type TraceSpanTotalsGroup,
} from "../trace-braid-reads.repository.ts";

/** The memory tier stores no spans in ClickHouse, so every braid read answers empty. */
export class MemoryNullTraceBraidReadsRepository extends TraceBraidReadsRepository {
  private constructor() {
    super();
  }

  static create(): MemoryNullTraceBraidReadsRepository {
    return new MemoryNullTraceBraidReadsRepository();
  }

  async findReaderTraceIds(): Promise<string[]> {
    return [];
  }

  async countOwnerSpansInTraces(): Promise<BraidOwnerTraceCounts> {
    return NO_BRAID_TRACE_COUNTS;
  }

  async findAttributeKeys(): Promise<{ key: string; spanCount: number }[]> {
    return [];
  }

  async countOwnerBraidActivity(): Promise<Map<string, number>> {
    return new Map();
  }

  async countReaderBraidActivity(): Promise<Map<string, number>> {
    return new Map();
  }

  async sumSpansInTrace(): Promise<TraceSpanTotalsGroup[]> {
    return [];
  }

  async findOwnerSpansMarked(): Promise<(TraceSpanSummaryRecord & { braided: boolean })[]> {
    return [];
  }
}
