// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import type { DigestTemplateId } from "@langwatch/enterprise-digest-contract";

/** One person's weekly email as digest hands it over: the template, its props, the envelope. */
export type DigestMail = Readonly<{
  to: string;
  templateId: DigestTemplateId;
  /** The template's props; `@langwatch/mail` parses them with the template's own schema. */
  props: Readonly<Record<string, unknown>>;
  /** The RFC 8058 one-click address the mail client POSTs to. */
  oneClickUnsubscribeUrl: string;
  /** One person's week; a retry carries the same key. Absent on an operator's test. */
  idempotencyKey?: string;
  /** An operator's test of someone else's week: marked in the subject. */
  test: boolean;
}>;

/**
 * Where the weekly email leaves digest. Digest owns none of the rendering or the envelope:
 * the template is `@langwatch/mail`'s and the sender is notification's (ADR-001).
 */
export abstract class DigestMailChannel {
  abstract send(mail: DigestMail): Promise<void>;
}
