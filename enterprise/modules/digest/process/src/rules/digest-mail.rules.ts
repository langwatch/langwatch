// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import { mailTemplates, renderMailTemplate } from "@langwatch/mail";
import { sendEmailCommandSchema } from "@langwatch/notification-contract";

import type { DigestMail, RenderedDigestMail } from "../channels/digest-mail.channel.ts";

/**
 * The address both the email's unsubscribe link (GET, a page) and its RFC 8058 header (POST) use.
 * It lives here, not in the send service, so the route can name it without a transport naming a service.
 */
export const DIGEST_UNSUBSCRIBE_PATH = "/api/digest/unsubscribe";

/**
 * Renders a composed digest email with its `@langwatch/mail` template and parses the command
 * notification will take. Everything that can refuse the email short of the mailer refuses it
 * here, so a send can do this before it claims the week and a refusal leaves the week unclaimed.
 *
 * @throws when the template's own schema refuses the props, or notification's command schema
 *   refuses the envelope (an unsubscribe address that is not a URL, say).
 */
export async function renderDigestMail(mail: DigestMail): Promise<RenderedDigestMail> {
  const template = mailTemplates.find((candidate) => candidate.id === mail.templateId);
  if (!template) throw new Error(`@langwatch/mail holds no ${mail.templateId} template`);
  // The rendered plain-text part is left behind: `SendEmailCommand` is strict and takes none.
  const { subject, html } = await renderMailTemplate(template, mail.props);
  const email = sendEmailCommandSchema.parse({
    to: mail.to,
    subject: mail.test ? `[Test] ${subject}` : subject,
    html,
    unsubscribe: { url: mail.oneClickUnsubscribeUrl },
    ...(mail.idempotencyKey === undefined ? {} : { idempotencyKey: mail.idempotencyKey }),
  });
  return { ...mail, email };
}
