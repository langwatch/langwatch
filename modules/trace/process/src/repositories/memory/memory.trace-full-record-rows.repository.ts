import { TraceCapabilityUnavailableError } from "@langwatch/trace-contract";

import type { StoredSpanRow } from "../../rules/trace-full-record.rules.ts";
import {
  TraceFullRecordRowsRepository,
  type TraceFullSummaryRow,
  type TraceFullThreadTraceRow,
} from "../trace-full-record-rows.repository.ts";

/** The memory tier holds no ClickHouse, so a full record refuses by name, as its client did. */
export class MemoryTraceFullRecordRowsRepository extends TraceFullRecordRowsRepository {
  private constructor() {
    super();
  }

  static create(): MemoryTraceFullRecordRowsRepository {
    return new MemoryTraceFullRecordRowsRepository();
  }

  getSummary(): Promise<TraceFullSummaryRow> {
    return MemoryTraceFullRecordRowsRepository.unavailable();
  }

  findSpans(): Promise<StoredSpanRow[]> {
    return MemoryTraceFullRecordRowsRepository.unavailable();
  }

  findThreadTraces(): Promise<TraceFullThreadTraceRow[]> {
    return MemoryTraceFullRecordRowsRepository.unavailable();
  }

  private static unavailable(): Promise<never> {
    return Promise.reject(new TraceCapabilityUnavailableError("memory", "a ClickHouse client"));
  }
}
