export { ReplayService } from "./replayService";
export type { ReplayLogWriter } from "./replayLog";
export { createReplayRuntime, type ReplayRuntime } from "./replayPreset";
export type {
  RegisteredFoldProjection,
  RegisteredMapProjection,
  RegisteredStateProjection,
  ProjectionKind,
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
