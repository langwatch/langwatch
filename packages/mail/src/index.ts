/**
 * Transactional message templates moved from platform/app; notification sends them.
 * Messages carry built links, never base URLs.
 */
export {
  sendEmail,
  type EmailAttachment,
  type EmailContent,
  type MailSender,
} from "./email-sender.ts";
export { MailRender } from "./mail-render.ts";
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
export { sendAddressConfirmationEmail } from "./templates/address-confirmation-email.tsx";
export { sendOrganizationMfaRequirementEmail } from "./templates/organization-mfa-requirement-email.tsx";
export {
  sendSsoDomainProofLapsedEmail,
  sendSsoDomainProofWaveringEmail,
} from "./templates/sso-domain-proof-emails.tsx";
export { sendUsageLimitEmail } from "./templates/usage-limit-email.tsx";
