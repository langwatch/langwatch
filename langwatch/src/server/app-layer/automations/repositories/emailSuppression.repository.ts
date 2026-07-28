/** A persisted suppression row (ADR-031). `triggerId === null` means the row
 *  suppresses every trigger in the project. */
export interface EmailSuppressionRow {
  id: string;
  projectId: string;
  email: string;
  triggerId: string | null;
  reason: string;
  createdAt: Date;
}

export interface EmailSuppressionRepository {
  findAllForProject(params: {
    projectId: string;
  }): Promise<EmailSuppressionRow[]>;

  /** Idempotent upsert on the (projectId, email, triggerId) unique key. */
  create(params: {
    projectId: string;
    email: string;
    triggerId: string | null;
    reason: string;
  }): Promise<EmailSuppressionRow>;

  delete(params: { projectId: string; id: string }): Promise<void>;

  /** All rows for the project whose triggerId is null (project-wide) OR equals
   *  the given trigger. Returned emails are already lowercased. */
  findMatching(params: {
    projectId: string;
    triggerId: string;
  }): Promise<EmailSuppressionRow[]>;
}

/** Resolved names for the unsubscribe display page (project + optional trigger). */
export interface UnsubscribeNames {
  projectName: string;
  triggerName: string | null;
}

/**
 * ADR-031: separate lookup port for project/trigger display names. Kept apart
 * from EmailSuppressionRepository because the data lives in different Prisma
 * models (Project, Trigger), not in EmailSuppression.
 */
export interface EmailSuppressionNameLookupRepository {
  /** Returns null when the project no longer exists. */
  lookupNames(params: {
    projectId: string;
    triggerId: string | null;
  }): Promise<UnsubscribeNames | null>;

  /** Returns a map of triggerId → name for the given set of trigger IDs. */
  findTriggerNames(params: {
    projectId: string;
    triggerIds: string[];
  }): Promise<Map<string, string>>;
}

export class NullEmailSuppressionNameLookupRepository
  implements EmailSuppressionNameLookupRepository
{
  async lookupNames(): Promise<UnsubscribeNames | null> {
    return null;
  }

  async findTriggerNames(): Promise<Map<string, string>> {
    return new Map();
  }
}

export class NullEmailSuppressionRepository
  implements EmailSuppressionRepository
{
  async findAllForProject(): Promise<EmailSuppressionRow[]> {
    return [];
  }

  async create(params: {
    projectId: string;
    email: string;
    triggerId: string | null;
    reason: string;
  }): Promise<EmailSuppressionRow> {
    return {
      id: "null-suppression",
      projectId: params.projectId,
      email: params.email.trim().toLowerCase(),
      triggerId: params.triggerId,
      reason: params.reason,
      createdAt: new Date(),
    };
  }

  async delete(): Promise<void> {
    // no-op
  }

  async findMatching(): Promise<EmailSuppressionRow[]> {
    return [];
  }
}
