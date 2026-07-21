export type {
  LangyConversationState,
  LangyConversationStateData,
} from "./langyConversationState.foldProjection";
export { LangyConversationStateFoldProjection } from "./langyConversationState.foldProjection";
// The turn document's data type, key helpers, and the fold itself live in
// @langwatch/langy (ADR-059) — import those from the package directly.
export type { LangyConversationTurn } from "./langyConversationTurn.foldProjection";
export { LangyConversationTurnFoldProjection } from "./langyConversationTurn.foldProjection";
export { LangyMessageOperationalMapProjection } from "./langyMessageOperational.mapProjection";
export type { LangyMessageProjectionRecord } from "./langyMessageOperational.mapProjection";
export {
  LangyAnalyticsEventMapProjection,
  type LangyAnalyticsEventProjectionRecord,
} from "./langyAnalyticsEvent.mapProjection";
export { LangyAnalyticsEventAppendStore } from "./langyAnalyticsEvent.store";
