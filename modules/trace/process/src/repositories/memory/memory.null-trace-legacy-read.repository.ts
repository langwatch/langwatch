import { TraceCapabilityUnavailableError } from "@langwatch/trace-contract";

import { TraceLegacyReadRepository } from "../../features/legacy/repositories/trace-legacy-read.repository.ts";

/** The memory tier holds no trace_summaries or stored_spans: every legacy read refuses by name. */
export class MemoryNullTraceLegacyReadRepository extends TraceLegacyReadRepository {
  static create(): MemoryNullTraceLegacyReadRepository {
    return new MemoryNullTraceLegacyReadRepository();
  }

  private constructor() {
    super();
  }

  listAllTracesForProject = refuse;
  findTraceSummaries = refuse;
  findCustomersAndLabels = refuse;
  findDistinctFieldNames = refuse;
  findTopicCounts = refuse;
  findTracesByThreadId = refuse;
  findTracesWithSpans = refuse;
  findTracesWithSpansByThreadIds = refuse;
  resolveTraceIdByPrefix = refuse;
  findSpanForPromptStudio = refuse;
}

function refuse(): Promise<never> {
  return Promise.reject(new TraceCapabilityUnavailableError("memory", "a ClickHouse client"));
}
