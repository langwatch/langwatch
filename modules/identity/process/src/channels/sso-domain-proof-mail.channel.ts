/** What to publish again, named exactly, in both domain-proof mails. */
export type SsoDomainProofRecord = {
  recordType: string;
  recordName: string;
  recordLabel: string;
};

/**
 * The two mails a verified domain's evidence going missing sends (ADR-123).
 * Same split as {@link JoinRequestMail}: resolved names and addresses in,
 * the link and the envelope the composition root's.
 */
export interface SsoDomainProofMail {
  /** The record is gone and the grace has started. Sent to one admin. */
  sendProofWavering(input: {
    adminEmail: string;
    organizationName: string;
    domain: string;
    record: SsoDomainProofRecord;
    graceEndsAtMs: number;
    /** This admin's delivery identity for this notice, so a retry is not a second mail. */
    idempotencyKey?: string;
  }): Promise<unknown>;

  /** The grace ran out. Sent to one admin. */
  sendProofLapsed(input: {
    adminEmail: string;
    organizationName: string;
    domain: string;
    record: SsoDomainProofRecord;
    /** This admin's delivery identity for this notice, so a retry is not a second mail. */
    idempotencyKey?: string;
  }): Promise<unknown>;
}

/**
 * The two mails a verified domain's evidence going missing sends. Who is told is the
 * notification service's decision, the envelope and template the mail composition's.
 * The memory tier records and sends nothing.
 */
export abstract class SsoDomainProofMailChannel implements SsoDomainProofMail {
  abstract sendProofWavering(
    input: Parameters<SsoDomainProofMail["sendProofWavering"]>[0],
  ): Promise<unknown>;
  abstract sendProofLapsed(
    input: Parameters<SsoDomainProofMail["sendProofLapsed"]>[0],
  ): Promise<unknown>;
}
