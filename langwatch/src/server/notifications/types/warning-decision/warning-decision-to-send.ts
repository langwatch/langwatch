import type { UsageThreshold } from "../../helpers/usage-calculations";
import type { OrganizationWithAdmins } from "../organization-repository.types";
import type { ProjectUsageData } from "../email-params/project-usage-data";

/**
 * Decision result when warning SHOULD be sent
 */
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

