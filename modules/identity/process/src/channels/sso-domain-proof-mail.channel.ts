import type { SsoDomainProofMail } from "../app/identity.members.ts";

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
