// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import type { SendEmailCommand } from "@langwatch/notification-contract";

import type { DigestTemplateProps } from "../rules/digest-email.rules.ts";

/** One person's weekly email as digest composes it: the template, its props, the envelope. */
export type DigestMail = DigestTemplateProps &
  Readonly<{
    to: string;
    /** The RFC 8058 one-click address the mail client POSTs to. */
    oneClickUnsubscribeUrl: string;
    /** One person's week; a retry carries the same key. Absent on an operator's test. */
    idempotencyKey?: string;
    /** An operator's test of someone else's week: marked in the subject. */
    test: boolean;
  }>;

/**
 * A composed email after it rendered and its command parsed: nothing left that can refuse it
 * but the mailer. A send claims its week only once it holds one of these.
 */
export type RenderedDigestMail = DigestMail & Readonly<{ email: SendEmailCommand }>;

/**
 * Where the weekly email leaves digest, already rendered. Digest owns none of the rendering or
 * the envelope: the template is `@langwatch/mail`'s and the sender is notification's (ADR-001).
 */
export abstract class DigestMailChannel {
  abstract send(mail: RenderedDigestMail): Promise<void>;
}
