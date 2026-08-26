export * from "./coding-agent";
export * from "./coding-agent.service";
export * from "./telemetry";
export * from "./telemetry/coding-agent-normalization";
// Temporary test/pure-derivation compatibility exports; production app paths
// use CodingAgentService methods and do not depend on these directly.
export * from "./coding-agent-log-content";
export { buildCodingAgentTranscript } from "./coding-agent-transcript";
export type {
  CodingAgentTranscript,
  TranscriptEntry,
  TranscriptLogRecord,
} from "./coding-agent-transcript";
export type { LogContentCategory, LogContentKey } from "./coding-agent-log-content";
