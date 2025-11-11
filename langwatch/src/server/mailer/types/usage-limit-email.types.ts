/**
 * Types for usage limit email
 */

export interface ProjectUsageData {
  id: string;
  name: string;
  messageCount: number;
}

export interface UsageLimitEmailProps {
  organizationName: string;
  usagePercentage: number;
  usagePercentageFormatted: string;
  currentMonthMessagesCount: number;
  maxMonthlyUsageLimit: number;
  crossedThreshold: number;
  projectUsageData: ProjectUsageData[];
  actionUrl: string;
  logoUrl: string;
}

export interface SendUsageLimitEmailParams extends UsageLimitEmailProps {
  to: string;
  severity: string;
}

