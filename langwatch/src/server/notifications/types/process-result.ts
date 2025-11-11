/**
 * Result of processing usage limits for an organization
 */
export interface ProcessResult {
  organizationId: string;
  notificationSent: boolean;
  error?: Error;
}

