import { verifyUnsubscribeToken } from "~/server/mailer/unsubscribeToken";
import type {
  EmailSuppressionNameLookupRepository,
  EmailSuppressionRepository,
  EmailSuppressionRow,
  UnsubscribeNames,
} from "./repositories/emailSuppression.repository";

const normalizeEmail = (email: string): string => email.trim().toLowerCase();

export type UnsubscribeScope = "trigger" | "project";

/**
 * ADR-031: thrown when a token is missing, malformed, or fails its HMAC check.
 * Distinct from a downstream persistence failure so transports can map it to a
 * 4xx ("invalid link") rather than masking a 5xx DB blip as a bad token.
 */
export class InvalidUnsubscribeTokenError extends Error {
  constructor() {
    super("Invalid or tampered unsubscribe token");
    this.name = "InvalidUnsubscribeTokenError";
  }
}

export interface UnsubscribeView {
  projectName: string;
  /** Null when the link is project-wide (token's triggerId is null). */
  triggerName: string | null;
  /** Masked for display — the page never echoes the full recipient address. */
  email: string;
}

/** `alice@example.com` → `a***@example.com`. Fixed three-star mask so the
 *  rendered string never leaks the local-part length. */
export function maskEmail(email: string): string {
  const at = email.indexOf("@");
  if (at <= 0) return "***";
  return `${email[0]}***${email.slice(at)}`;
}

/** A suppression row enriched with its trigger's display name. */
export interface EnrichedEmailSuppressionRow extends EmailSuppressionRow {
  triggerName: string | null;
}

/**
 * ADR-031: recipient suppression list for trigger emails. Owns email
 * normalization (always lowercase) so callers can pass whatever casing the
 * author typed and the unique constraint still collapses duplicates.
 */
export class EmailSuppressionService {
  constructor(
    private readonly repo: EmailSuppressionRepository,
    private readonly nameLookup: EmailSuppressionNameLookupRepository,
  ) {}

  async getAllForProject({
    projectId,
  }: {
    projectId: string;
  }): Promise<EmailSuppressionRow[]> {
    return this.repo.findAllForProject({ projectId });
  }

  /**
   * Returns all suppressions for the project, each annotated with its
   * trigger's display name (null for project-wide rows). Keeps the router
   * free of Prisma-level lookups.
   */
  async getAllEnriched({
    projectId,
  }: {
    projectId: string;
  }): Promise<EnrichedEmailSuppressionRow[]> {
    const rows = await this.repo.findAllForProject({ projectId });
    const triggerIds = [
      ...new Set(
        rows.map((r) => r.triggerId).filter((id): id is string => id != null),
      ),
    ];
    const nameById = await this.nameLookup.findTriggerNames({
      projectId,
      triggerIds,
    });
    return rows.map((r) => ({
      ...r,
      triggerName:
        r.triggerId != null ? (nameById.get(r.triggerId) ?? null) : null,
    }));
  }

  /**
   * Resolves the project and optional trigger names needed for the public
   * unsubscribe display page. Returns null when the project no longer exists.
   */
  async lookupNames({
    projectId,
    triggerId,
  }: {
    projectId: string;
    triggerId: string | null;
  }): Promise<UnsubscribeNames | null> {
    return this.nameLookup.lookupNames({ projectId, triggerId });
  }

  /**
   * Resolves an unsubscribe token into the display view for the public
   * `/unsubscribe` page. Returns null on an invalid/tampered token or a
   * project that no longer exists. Transports add nothing but error mapping.
   */
  async resolveUnsubscribeView({
    token,
  }: {
    token: string;
  }): Promise<UnsubscribeView | null> {
    const payload = verifyUnsubscribeToken(token);
    if (!payload) return null;

    const names = await this.nameLookup.lookupNames({
      projectId: payload.projectId,
      triggerId: payload.triggerId,
    });
    if (!names) return null;

    return {
      projectName: names.projectName,
      triggerName: names.triggerName,
      email: maskEmail(payload.email),
    };
  }

  /**
   * Verifies an unsubscribe token and records the suppression at the given
   * scope. Throws `InvalidUnsubscribeTokenError` on a bad/tampered token so
   * transports can map it to a 4xx distinct from persistence failures.
   * Idempotent — the underlying create collapses duplicates.
   */
  async confirmUnsubscribe({
    token,
    scope,
  }: {
    token: string;
    scope: UnsubscribeScope;
  }): Promise<void> {
    const payload = verifyUnsubscribeToken(token);
    if (!payload) {
      throw new InvalidUnsubscribeTokenError();
    }
    await this.suppress({
      projectId: payload.projectId,
      email: payload.email,
      triggerId: scope === "project" ? null : payload.triggerId,
      reason: "unsubscribe",
    });
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
