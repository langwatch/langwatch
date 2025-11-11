import type { UsageLimitEmailProps } from "./usage-limit-email-props";

/**
 * Parameters for sending usage limit email
 */
export interface SendUsageLimitEmailParams extends UsageLimitEmailProps {
  to: string;
  severity: string;
}

