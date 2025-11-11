import type { ProjectUsageData } from "./project-usage-data";

/**
 * Props for UsageLimitEmailTemplate component
 */
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

