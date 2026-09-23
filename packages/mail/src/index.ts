/**
 * Mail gateways and transactional message templates moved from platform/app.
 * Two explicit rules: messages carry built links (not base URLs); configuration
 * comes from process (not environment), keeping credentials stable per process lifetime.
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
export {
  buildSmtpTransportOptions,
  isSmtpConfigured,
  SmtpEmailProvider,
} from "./providers/smtp.ts";
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
export {
  sendConnectedStatementEmail,
  type ConnectedStatementEmailProps,
} from "./templates/connected-statement-email.tsx";
export { sendLicenseEmail } from "./templates/license-email.tsx";
export { sendResetPasswordEmail } from "./templates/reset-password-email.tsx";
export { sendSignUpVerificationEmail } from "./templates/sign-up-verification-email.tsx";
export {
  sendSsoDomainProofLapsedEmail,
  sendSsoDomainProofWaveringEmail,
} from "./templates/sso-domain-proof-emails.tsx";
export { sendUsageLimitEmail } from "./templates/usage-limit-email.tsx";
