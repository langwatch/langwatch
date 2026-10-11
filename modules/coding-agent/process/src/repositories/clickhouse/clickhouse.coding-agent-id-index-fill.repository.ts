import {
  type ClickHouseQueryClient,
  fillOwnerIdIndexes,
  type IdIndexDeclaration,
  type IdIndexFillReport,
  type IdIndexOwnerFill,
  IdIndexReadiness,
  idIndexReadinessTargets,
} from "@langwatch/clickhouse-client";

import { CodingAgentIdIndexFillRepository } from "../coding-agent-id-index-fill.repository.ts";

/** The indexes goose 00117 creates, in the order the fill visits them. */
export const CODING_AGENT_ID_INDEXES: readonly IdIndexDeclaration[] = [
  {
    source: "coding_agent_sessions",
    index: "coding_agent_sessions_id_index",
    key: ["SessionId"],
    time: "StartedAt",
    retentionAnchor: "StartedAt",
    retention: "copied",
  },
  {
    source: "coding_agent_session_events",
    index: "coding_agent_session_events_id_index",
    key: ["SessionId"],
    time: "TimeUnixMs",
    retentionAnchor: "TimeUnixMs",
    retention: "copied",
  },
  {
    source: "coding_agent_trace_sessions",
    index: "coding_agent_trace_sessions_id_index",
    key: ["TraceId"],
    time: "OccurredAt",
    retentionAnchor: "OccurredAt",
    retention: "copied",
  },
];

/** Fills the id indexes on the shared server and every private one, through the routed client. */
export class CodingAgentIdIndexFillClickHouseRepository extends CodingAgentIdIndexFillRepository {
  static create({
    clickhouse,
  }: {
    clickhouse: ClickHouseQueryClient;
  }): CodingAgentIdIndexFillClickHouseRepository {
    return new CodingAgentIdIndexFillClickHouseRepository(clickhouse);
  }

  readonly readiness: IdIndexReadiness;

  private constructor(private readonly clickhouse: ClickHouseQueryClient) {
    super();
    this.readiness = IdIndexReadiness.create({
      statements: clickhouse,
      indexes: CODING_AGENT_ID_INDEXES,
      watch: () => idIndexReadinessTargets({ privateRoutes: clickhouse.privateRoutes() }),
    });
  }

  fill(input: IdIndexOwnerFill): Promise<IdIndexFillReport> {
    return fillOwnerIdIndexes({
      ...input,
      clickhouse: this.clickhouse,
      indexes: CODING_AGENT_ID_INDEXES,
    });
  }
}
