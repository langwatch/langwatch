import type { WarningDecision } from "./warning-decision";
import type { WarningDecisionToSend } from "./warning-decision-to-send";

/**
 * Union type for all warning decision results
 */
export type WarningDecisionResult = WarningDecision | WarningDecisionToSend;

