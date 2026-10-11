import {
  type ClickHouseQueryClient,
  type FillIdIndexesOptions,
  fillIdIndexes,
  type IdIndexDeclaration,
  type IdIndexFillReport,
  idIndexFillTargets,
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

  private constructor(private readonly clickhouse: ClickHouseQueryClient) {
    super();
  }

  indexesWithCopiedRetention(): string[] {
    return CODING_AGENT_ID_INDEXES.filter((each) => each.retention === "copied").map(
      (each) => each.index,
    );
  }

  fill(
    input: Omit<FillIdIndexesOptions, "statements" | "targets" | "indexes">,
  ): Promise<IdIndexFillReport> {
    return fillIdIndexes({
      ...input,
      indexes: CODING_AGENT_ID_INDEXES,
      statements: this.clickhouse,
      targets: idIndexFillTargets({ privateRoutes: this.clickhouse.privateRoutes() }),
    });
  }
}
