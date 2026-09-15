import type {
  CodingAgentSession,
  CodingAgentSessionEventRecord,
  CodingAgentSessionMetricSeriesRecord,
  CodingAgentTraceSessionRecord,
} from "@langwatch/coding-agent-contract";

/** One stored session and the fold events already applied to it. */
export interface MemoryStoredSession {
  row: CodingAgentSession;
  appliedEventIds: string[];
}

/**
 * The one store behind the memory tier, the way one ClickHouse endpoint holds
 * every coding-agent projection: a session written through `sessions` is what
 * `traceSessions` and `sessionEvents` are read against in the same test.
 */
export class MemoryCodingAgentDatabase {
  static create(): MemoryCodingAgentDatabase {
    return new MemoryCodingAgentDatabase();
  }

  readonly sessions = new Map<string, MemoryStoredSession>();
  readonly traceSessions = new Map<string, CodingAgentTraceSessionRecord>();
  readonly sessionEvents: CodingAgentSessionEventRecord[] = [];
  readonly metricSeries: CodingAgentSessionMetricSeriesRecord[] = [];

  private constructor() {}

  /** The one key shape a tenant-scoped row is held under. */
  static key(tenantId: string, id: string): string {
    return `${tenantId}:${id}`;
  }
}
