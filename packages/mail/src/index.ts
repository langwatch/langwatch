/**
 * `@langwatch/mail` — the outbound mail gateways LangWatch sends through, and
 * the transactional messages the identity and organization surfaces send.
 *
 * Everything here was `platform/app/src/server/mailer`, which is why the
 * gateway half arrives whole: the provider selection, the MIME assembly and
 * the four transports are one decision, and a second copy of the selection
 * rule is how a deployment starts sending from an unexpected sender domain.
 *
 * Two rules the move made explicit, both of which used to be `~/env.mjs`
 * reads inside a template:
 *
 *  - a message that carries a link takes the LINK, never a base URL it
 *    assembles for itself. The URL builders belong to the feature that owns
 *    the destination, and passing the built link is what stops the mail and
 *    the API answering with two different addresses for one invitation;
 *  - a gateway takes its `MailerConfiguration` from the process. Nothing here
 *    reads an environment variable, so a credential is stable for the lifetime
 *    of the process that composed it.
 *
 * The trace-settlement digest IS here now, and the reason it was not is the
 * reason the split below exists. It lived beside the transports that send it
 * because the footer, the no-reply `To` and the BCC fan-out are one envelope
 * decision with the unsubscribe token that signs it — but rendering it there
 * put react-email, and so React, on the worker's boot graph, next to a twin of
 * the join-request mails this package already held. `MailRender` keeps the
 * envelope where it belongs and moves only the words: this package renders,
 * the process sends. The usage-limit, automation-limit and licence messages
 * are whole sends, because each has no transport decision of its own and the
 * vertical that decides when to send one holds only a port.
 */
export {
  EmailDelivery,
  EmailProviderConfigurationError,
  EMAIL_PROVIDER_NAMES,
  toArray,
  type EmailAttachment,
  type EmailContent,
  type EmailProviderName,
  type EmailProvider,
  type MailerConfiguration,
} from "./providers/types.ts";
export { hasEmailProvider, resolveEmailProviderName } from "./providers/index.ts";
export {
  buildSesClientConfig,
  SesEmailProvider,
  type SesAwsClientConfiguration,
} from "./providers/ses.ts";
export { SendgridEmailProvider } from "./providers/sendgrid.ts";
export { buildSmtpTransportOptions, isSmtpConfigured, SmtpEmailProvider } from "./providers/smtp.ts";
export { ResendEmailProvider } from "./providers/resend.ts";
export { computeDefaultFrom, sendEmail } from "./email-sender.ts";
export { MailRender } from "./ports/mail-render.port.ts";
export { mailTemplates } from "./templates/index.ts";
export { propsFormSchema, renderMailTemplate } from "./templates/registry.ts";
export type { MailFixture, MailTemplate } from "./templates/registry.ts";
export { expressive } from "./templates/email-layout.tsx";
export { ReactEmailMailRenderer } from "./adapters/react-email.render.adapter.ts";
export {
  renderTriggerDigestEmail,
  type TriggerDigestEntry,
  type TriggerDigestMail,
} from "./templates/trigger-digest-email.tsx";
export { sendBudgetIncreaseRequestEmail } from "./templates/budget-increase-request-email.tsx";
export type { SendBudgetIncreaseRequestEmailInput } from "./templates/budget-increase-request-email.tsx";
export { sendInviteEmail } from "./templates/invite-email.tsx";
export { sendInviteReRequestEmail } from "./templates/invite-re-request-email.tsx";
export {
  joinRequestExpiredSubject,
  joinRequestReminderSubject,
  renderJoinRequestExpiredEmail,
  renderJoinRequestReminderEmail,
  sendDomainAutoJoinedEmail,
  sendJoinRequestApprovedEmail,
  sendJoinRequestArrivedEmail,
  sendJoinRequestExpiredEmail,
  sendJoinRequestReminderEmail,
  sendJoinRequestRejectedEmail,
} from "./templates/join-request-emails.tsx";
export {
  automationLimitEmailSubject,
  renderAutomationLimitEmail,
  sendAutomationLimitEmail,
  type AutomationLimitKind,
} from "./templates/automation-limit-email.tsx";
export { sendLicenseEmail } from "./templates/license-email.tsx";
export { sendResetPasswordEmail } from "./templates/reset-password-email.tsx";
export { sendSignUpVerificationEmail } from "./templates/sign-up-verification-email.tsx";
export { sendUsageLimitEmail } from "./templates/usage-limit-email.tsx";
