import type { UsageThreshold } from "../helpers/usage-calculations";
import type { OrganizationWithAdmins } from "../repositories/organization.repository";
import type { ProjectUsageData } from "../services/notification-email.service";

/**
 * Decision result for whether to send a usage warning
 */
export interface WarningDecision {
  shouldSend: false;
  reason:
    | "below_threshold"
    | "organization_not_found"
    | "no_admins"
    | "already_sent";
}

export interface WarningDecisionToSend {
  shouldSend: true;
  organizationId: string;
  organization: OrganizationWithAdmins;
  usagePercentage: number;
  currentMonthMessagesCount: number;
  maxMonthlyUsageLimit: number;
  crossedThreshold: UsageThreshold;
  projectUsageData: ProjectUsageData[];
  severity: string;
}

export type WarningDecisionResult = WarningDecision | WarningDecisionToSend;

