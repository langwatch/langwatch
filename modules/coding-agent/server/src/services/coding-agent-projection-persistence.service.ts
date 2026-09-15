import {
  CodingAgentProjectionPersistence,
  type CodingAgentSession,
  type CodingAgentSessionEventRecord,
  type CodingAgentSessionMetricSeriesRecord,
  type CodingAgentTraceSessionRecord,
} from "@langwatch/coding-agent-contract";
import type { CodingAgentRepositories } from "../repositories/coding-agent.repositories.ts";

/**
 * What the fold commits one session through: the projection lifecycle boundary
 * the event pipeline installs, over the rows the process selected. It is not a
 * second domain service - ordinary callers use CodingAgentSessionService.
 */
export class CodingAgentProjectionPersistenceService extends CodingAgentProjectionPersistence {
  static create(repositories: CodingAgentRepositories): CodingAgentProjectionPersistenceService {
    return new CodingAgentProjectionPersistenceService(repositories);
  }

  private constructor(private readonly repositories: CodingAgentRepositories) {
    super();
  }

  storeSession(input: {
    row: CodingAgentSession;
    retentionDays: number;
    appliedEventIds: readonly string[];
  }): Promise<void> {
    return this.repositories.sessions.upsert(input.row, input.retentionDays, input.appliedEventIds);
  }

  storeSessionBatch(
    rows: Array<{
      row: CodingAgentSession;
      retentionDays: number;
      appliedEventIds: readonly string[];
    }>,
  ): Promise<void> {
    return this.repositories.sessions.upsertBatch(rows);
  }

  loadSessionWithApplied(input: {
    tenantId: string;
    sessionId: string;
    window?: { fromMs: number; toMs: number };
  }): Promise<{ row: CodingAgentSession; appliedEventIds: string[] } | null> {
    return this.repositories.sessions.findBySessionIdWithApplied(input);
  }

  appendTraceSessions(
    records: CodingAgentTraceSessionRecord[],
    retentionDays: number,
  ): Promise<void> {
    return this.repositories.traceSessions.ensure(records, retentionDays);
  }

  appendMetricSeries(
    records: CodingAgentSessionMetricSeriesRecord[],
    retentionDays: number,
  ): Promise<void> {
    return this.repositories.metricSeries.ensure(records, retentionDays);
  }

  appendSessionEvents(
    records: CodingAgentSessionEventRecord[],
    retentionDays: number,
  ): Promise<void> {
    return this.repositories.sessionEvents.ensure(records, retentionDays);
  }
}
