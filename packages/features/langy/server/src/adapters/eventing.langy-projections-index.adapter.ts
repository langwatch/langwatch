// The spine's data type, fold, and the message record/map live in
// The contract package (ADR-059) owns these reducers; import them directly.

export {
  LangyAnalyticsEventMapProjection,
  type LangyAnalyticsEventProjectionRecord,
} from "../projections/langy-analytics-event.projection";
export type { LangyConversationState } from "../projections/langy-conversation-state.projection";
export { LangyConversationStateFoldProjection } from "../projections/langy-conversation-state.projection";
// The turn document's data type, key helpers, and the fold itself live in
// The contract package (ADR-059) owns these reducers; import them directly.
export type { LangyConversationTurn } from "../projections/langy-conversation-turn.projection";
export { LangyConversationTurnFoldProjection } from "../projections/langy-conversation-turn.projection";
export { LangyMessageOperationalMapProjection } from "../projections/langy-message-operational.projection";
