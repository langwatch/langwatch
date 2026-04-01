export { ReplayService, type ReplayLogWriter } from "./replayService";
export { createReplayRuntime, createReplayRuntimeWithResolver, type ReplayRuntime } from "./replayPreset";
export type {
  RegisteredFoldProjection,
  ReplayConfig,
  ReplayResult,
  ReplayCallbacks,
  ReplayProgress,
  BatchPhase,
  BatchCompleteInfo,
  DiscoveryResult,
} from "./types";
export type { DiscoveredAggregate, ReplayEvent, CutoffInfo } from "./replayEventLoader";
export { isAtOrBeforeCutoff, isAtOrBeforeCutoffMarker, CUTOFF_KEY_PREFIX, COMPLETED_KEY_PREFIX } from "./replayConstants";
