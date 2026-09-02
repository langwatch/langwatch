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
 * The trigger, usage-limit, automation-limit and licence messages did NOT
 * move: they belong to the automation and billing verticals, and they are
 * still the platform application's.
 */
export {
  EmailDeliveryPort,
  EmailProviderConfigurationError,
  EMAIL_PROVIDER_NAMES,
  toArray,
  type EmailAttachment,
  type EmailContent,
  type EmailProviderName,
  type EmailProviderPort,
  type MailerConfiguration,
} from "./providers/types";
export { hasEmailProvider, resolveEmailProviderName } from "./providers";
export {
  buildSesClientConfig,
  SesEmailProvider,
  type SesAwsClientConfiguration,
} from "./providers/ses";
export { SendgridEmailProvider } from "./providers/sendgrid";
export {
  buildSmtpTransportOptions,
  isSmtpConfigured,
  SmtpEmailProvider,
} from "./providers/smtp";
export { ResendEmailProvider } from "./providers/resend";
export { computeDefaultFrom, sendEmail } from "./email-sender";
export { sendBudgetIncreaseRequestEmail } from "./templates/budget-increase-request-email";
export type { SendBudgetIncreaseRequestEmailInput } from "./templates/budget-increase-request-email";
export { sendInviteEmail } from "./templates/invite-email";
export { sendInviteReRequestEmail } from "./templates/invite-re-request-email";
export {
  sendDomainAutoJoinedEmail,
  sendJoinRequestApprovedEmail,
  sendJoinRequestArrivedEmail,
  sendJoinRequestExpiredEmail,
  sendJoinRequestReminderEmail,
  sendJoinRequestRejectedEmail,
} from "./templates/join-request-emails";
export { sendResetPasswordEmail } from "./templates/reset-password-email";
export { sendSignUpVerificationEmail } from "./templates/sign-up-verification-email";
