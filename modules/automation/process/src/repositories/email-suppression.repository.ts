import type { EmailSuppression, EmailSuppressionCursor } from "@langwatch/automation-contract";
export abstract class EmailSuppressionRepository {
  abstract findAll(input: { projectId: string }): Promise<EmailSuppression[]>;
  /** At most `limit` rows after `cursor`, newest first, ties broken on the id. */
  abstract findPage(input: {
    projectId: string;
    limit: number;
    cursor: EmailSuppressionCursor | null;
  }): Promise<EmailSuppression[]>;
  abstract findMatching(input: {
    projectId: string;
    triggerId: string;
  }): Promise<EmailSuppression[]>;
  abstract create(input: {
    projectId: string;
    email: string;
    triggerId: string | null;
    reason: string;
  }): Promise<EmailSuppression>;
  abstract delete(input: { id: string; projectId: string }): Promise<void>;
}
