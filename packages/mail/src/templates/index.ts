import { automationLimitEmailTemplate } from "./automation-limit-email.tsx";
import { budgetIncreaseRequestEmailTemplate } from "./budget-increase-request-email.tsx";
import { inviteEmailTemplate } from "./invite-email.tsx";
import { inviteReRequestEmailTemplate } from "./invite-re-request-email.tsx";
import {
  domainAutoJoinedTemplate,
  joinRequestApprovedTemplate,
  joinRequestArrivedTemplate,
  joinRequestExpiredTemplate,
  joinRequestRejectedTemplate,
  joinRequestReminderTemplate,
} from "./join-request-emails.tsx";
import { licenseEmailTemplate } from "./license-email.tsx";
import type { MailTemplate } from "./registry.ts";
import { resetPasswordEmailTemplate } from "./reset-password-email.tsx";
import { signUpVerificationEmailTemplate } from "./sign-up-verification-email.tsx";
import {
  ssoDomainProofLapsedTemplate,
  ssoDomainProofWaveringTemplate,
} from "./sso-domain-proof-emails.tsx";
import { triggerDigestEmailTemplate } from "./trigger-digest-email.tsx";
import { usageLimitEmailTemplate } from "./usage-limit-email.tsx";

/**
 * Discovery surface for all transactional messages (preview studio uses it). Ordered:
 * pre-account messages → admin messages → product usage messages.
 */
export const mailTemplates: readonly MailTemplate[] = [
  signUpVerificationEmailTemplate,
  resetPasswordEmailTemplate,
  inviteEmailTemplate,
  inviteReRequestEmailTemplate,
  joinRequestArrivedTemplate,
  joinRequestReminderTemplate,
  joinRequestApprovedTemplate,
  joinRequestRejectedTemplate,
  joinRequestExpiredTemplate,
  domainAutoJoinedTemplate,
  ssoDomainProofWaveringTemplate,
  ssoDomainProofLapsedTemplate,
  licenseEmailTemplate,
  budgetIncreaseRequestEmailTemplate,
  usageLimitEmailTemplate,
  automationLimitEmailTemplate,
  triggerDigestEmailTemplate,
];

export { defineTemplate, propsFormSchema, renderMailTemplate } from "./registry.ts";
export type { MailFixture, MailTemplate } from "./registry.ts";
