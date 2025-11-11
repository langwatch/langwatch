import type { UsageThreshold } from "../helpers/usage-calculations";

/**
 * Project usage data for emails
 */
export interface ProjectUsageData {
  id: string;
  name: string;
  messageCount: number;
}

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

/**
 * Result of email sending operation
 */
export interface EmailSendResult {
  successCount: number;
  failureCount: number;
  failedRecipients: Array<{ userId: string; email: string; error: string }>;
}

