/**
 * Decision result when warning should NOT be sent
 */
export interface WarningDecision {
  shouldSend: false;
  reason:
    | "below_threshold"
    | "organization_not_found"
    | "no_admins"
    | "already_sent";
}

