import type { SeatRequestProps } from "@langwatch/mail";

type Envelope = Readonly<{ idempotencyKey: string }>;

/** The single refusal mail, as the access notice service hands it over. */
export type IdpRefusedMail = Readonly<{
  recipientEmail: string;
  organizationName: string;
  personName: string | null;
  personEmail: string;
  idpName: string | null;
}>;

/**
 * The seat request and refused sign-in mails to administrators and Billing members. Who
 * is told is the access notice service's decision; the envelope and template are the mail
 * composition's. The memory tier records and sends nothing.
 */
export abstract class AccessNoticeMailChannel {
  abstract sendSeatRequest(input: SeatRequestProps & Envelope): Promise<void>;
  abstract sendIdpRefused(input: IdpRefusedMail & Envelope): Promise<void>;
}
