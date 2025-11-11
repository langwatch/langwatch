import type { UsageThreshold } from "../../helpers/usage-calculations";
import type { ProjectUsageData } from "./project-usage-data";

/**
 * Parameters for sending usage limit emails
 */
export interface SendUsageLimitEmailsParams {
  organizationId: string;
  organizationName: string;
  adminEmails: Array<{ userId: string; email: string }>;
  usagePercentage: number;
  currentMonthMessagesCount: number;
  maxMonthlyUsageLimit: number;
  crossedThreshold: UsageThreshold;
  projectUsageData: ProjectUsageData[];
  severity: string;
  actionUrl: string;
}

