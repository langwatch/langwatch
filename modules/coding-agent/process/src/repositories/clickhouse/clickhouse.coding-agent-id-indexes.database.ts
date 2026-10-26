import { defineIdIndex, type IdIndexDeclaration } from "@langwatch/clickhouse-client";

/** The indexes goose 00117 creates, in the order the fill visits them. */
export const CODING_AGENT_ID_INDEXES: readonly IdIndexDeclaration[] = [
  defineIdIndex({ source: "coding_agent_sessions", key: ["SessionId"], time: "StartedAt" }),
  defineIdIndex({ source: "coding_agent_session_events", key: ["SessionId"], time: "TimeUnixMs" }),
  defineIdIndex({ source: "coding_agent_trace_sessions", key: ["TraceId"], time: "OccurredAt" }),
];
