import type {
  EmailSuppressionRepository,
  EmailSuppressionRow,
} from "./repositories/emailSuppression.repository";

const normalizeEmail = (email: string): string => email.trim().toLowerCase();

/**
 * ADR-031: recipient suppression list for trigger emails. Owns email
 * normalization (always lowercase) so callers can pass whatever casing the
 * author typed and the unique constraint still collapses duplicates.
 */
export class EmailSuppressionService {
  constructor(private readonly repo: EmailSuppressionRepository) {}

  async getAllForProject({
    projectId,
  }: {
    projectId: string;
  }): Promise<EmailSuppressionRow[]> {
    return this.repo.findAllForProject({ projectId });
  }

  async suppress({
    projectId,
    email,
    triggerId,
    reason = "unsubscribe",
  }: {
    projectId: string;
    email: string;
    triggerId: string | null;
    reason?: string;
  }): Promise<EmailSuppressionRow> {
    return this.repo.create({
      projectId,
      email: normalizeEmail(email),
      triggerId,
      reason,
    });
  }

  async remove({
    projectId,
    id,
  }: {
    projectId: string;
    id: string;
  }): Promise<void> {
    await this.repo.delete({ projectId, id });
  }

  /**
   * Returns `emails` minus any address suppressed for this trigger — matching
   * rows whose triggerId is null (project-wide) or equals `triggerId`. Casing
   * is ignored: comparison is on lowercased addresses, and the surviving
   * entries are returned in their original casing/order.
   */
  async filterSuppressed({
    projectId,
    triggerId,
    emails,
  }: {
    projectId: string;
    triggerId: string;
    emails: string[];
  }): Promise<string[]> {
    const matching = await this.repo.findMatching({ projectId, triggerId });
    const suppressed = new Set(matching.map((r) => normalizeEmail(r.email)));
    return emails.filter((e) => !suppressed.has(normalizeEmail(e)));
  }
}
