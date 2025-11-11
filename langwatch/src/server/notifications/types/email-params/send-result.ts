/**
 * Result of email sending operation
 */
export interface EmailSendResult {
  successCount: number;
  failureCount: number;
  failedRecipients: Array<{ userId: string; email: string; error: string }>;
}

