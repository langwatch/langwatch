import {
  InvalidUnsubscribeTokenError,
  maskEmail,
  suppressEmailCommandSchema,
  type EmailSuppression,
  type SuppressEmailCommand,
} from "@langwatch/automation-contract";

import type { EmailSuppressionNameRepository } from "../repositories/email-suppression-name.repository.ts";
import type { EmailSuppressionRepository } from "../repositories/email-suppression.repository.ts";
import type { UnsubscribeTokenVerifier } from "./unsubscribe-token.service.ts";

const normalize = (email: string): string => email.trim().toLowerCase();

/** Email suppressions and the unsubscribe flow behind `AutomationService`. */
export class AutomationEmailSuppressionService {
  private readonly suppressions: EmailSuppressionRepository;
  private readonly names: EmailSuppressionNameRepository;
  private readonly verifier: UnsubscribeTokenVerifier;

  private constructor({
    suppressions,
    names,
    verifier,
  }: {
    suppressions: EmailSuppressionRepository;
    names: EmailSuppressionNameRepository;
    verifier: UnsubscribeTokenVerifier;
  }) {
    this.suppressions = suppressions;
    this.names = names;
    this.verifier = verifier;
  }

  static create(deps: {
    suppressions: EmailSuppressionRepository;
    names: EmailSuppressionNameRepository;
    verifier: UnsubscribeTokenVerifier;
  }): AutomationEmailSuppressionService {
    return new AutomationEmailSuppressionService(deps);
  }

  getSuppressions(input: { projectId: string }): Promise<EmailSuppression[]> {
    return this.suppressions.findAll(input);
  }

  async getAllEnriched(input: {
    projectId: string;
  }): Promise<(EmailSuppression & { triggerName: string | null })[]> {
    const rows = await this.suppressions.findAll(input);
    const ids = [...new Set(rows.flatMap((row) => (row.triggerId ? [row.triggerId] : [])))];
    const names = await this.names.findTriggerNames({
      projectId: input.projectId,
      triggerIds: ids,
    });

    return rows.map((row) => ({
      ...row,
      triggerName: row.triggerId ? (names.get(row.triggerId) ?? null) : null,
    }));
  }

  async findUnsubscribeView(input: { token: string }): Promise<{
    projectName: string;
    triggerName: string | null;
    email: string;
  } | null> {
    const payload = this.verifier.findVerifiedPayload(input.token);
    if (!payload) {
      return null;
    }

    const names = await this.names.findNames(payload);
    if (!names) {
      return null;
    }

    return {
      projectName: names.projectName,
      triggerName: names.triggerName,
      email: maskEmail(payload.email),
    };
  }

  async confirmUnsubscribe(input: { token: string; scope: "trigger" | "project" }): Promise<void> {
    const payload = this.verifier.findVerifiedPayload(input.token);
    if (!payload) {
      throw new InvalidUnsubscribeTokenError();
    }

    await this.suppressEmail({
      projectId: payload.projectId,
      email: payload.email,
      triggerId: input.scope === "project" ? null : payload.triggerId,
    });
  }

  suppressEmail(input: SuppressEmailCommand): Promise<EmailSuppression> {
    const parsed = suppressEmailCommandSchema.parse(input);

    return this.suppressions.create({
      projectId: parsed.projectId,
      email: normalize(parsed.email),
      triggerId: parsed.triggerId,
      reason: parsed.reason ?? "unsubscribe",
    });
  }

  removeSuppression(input: { id: string; projectId: string }): Promise<void> {
    return this.suppressions.delete(input);
  }

  async filterSuppressed(input: {
    projectId: string;
    triggerId: string;
    emails: string[];
  }): Promise<string[]> {
    const rows = await this.suppressions.findMatching({
      projectId: input.projectId,
      triggerId: input.triggerId,
    });
    const blocked = new Set(rows.map((row) => normalize(row.email)));

    return input.emails.filter((email) => !blocked.has(normalize(email)));
  }
}
