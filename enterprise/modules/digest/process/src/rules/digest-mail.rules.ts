// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import type { MailRender } from "@langwatch/mail";
import { sendEmailCommandSchema } from "@langwatch/notification-contract";

import type { DigestMail, RenderedDigestMail } from "../channels/digest-mail.channel.ts";

/**
 * The address the email's RFC 8058 List-Unsubscribe header (POST) and its page (GET) use.
 * It lives here, not in the send service, so the route can name it without a transport naming a service.
 */
export const DIGEST_UNSUBSCRIBE_PATH = "/api/digest/unsubscribe";

/**
 * Where the email's footer link goes: the signed-in settings page that holds the weekly digest's
 * on/off switch. Signed-out clicks sign in first; the one-click header never uses it.
 */
export const DIGEST_EMAIL_PREFERENCES_PATH = "/settings/profile#email-preferences";

/** The digest's own renders on `@langwatch/mail`'s `MailRender`, one per template that sends. */
export type DigestMailRender = Pick<
  MailRender,
  | "renderDigestPlanPressure"
  | "renderDigestScenariosTrend"
  | "renderDigestCodingAgentWeek"
  | "renderDigestTracesWeek"
>;

/**
 * Renders a composed digest email and parses notification's command: everything short of the
 * mailer that can refuse it refuses here, so a send renders before claiming the week.
 * @throws when the template's or notification's schema refuses the props or the envelope.
 */
export async function renderDigestMail({
  mail,
  renderer,
}: {
  mail: DigestMail;
  renderer: DigestMailRender;
}): Promise<RenderedDigestMail> {
  const { subject: templateSubject, html } = await renderTemplate({ mail, renderer });
  // A person in several organizations gets one email per organization: the name tells them apart.
  const subject = mail.organizationName
    ? `${mail.organizationName}: ${templateSubject}`
    : templateSubject;
  const email = sendEmailCommandSchema.parse({
    to: mail.to,
    subject: mail.test ? `[Test] ${subject}` : subject,
    html,
    unsubscribe: { url: mail.oneClickUnsubscribeUrl },
    ...(mail.idempotencyKey === undefined ? {} : { idempotencyKey: mail.idempotencyKey }),
  });
  return { ...mail, email };
}

function renderTemplate({
  mail,
  renderer,
}: {
  mail: DigestMail;
  renderer: DigestMailRender;
}): Promise<{ subject: string; html: string }> {
  switch (mail.templateId) {
    case "digest-plan-pressure":
      return renderer.renderDigestPlanPressure(mail.props);
    case "digest-scenarios-trend":
      return renderer.renderDigestScenariosTrend(mail.props);
    case "digest-coding-agent-week":
      return renderer.renderDigestCodingAgentWeek(mail.props);
    case "digest-traces-week":
      return renderer.renderDigestTracesWeek(mail.props);
  }
}
