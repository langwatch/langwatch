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
import { triggerDigestEmailTemplate } from "./trigger-digest-email.tsx";
import { usageLimitEmailTemplate } from "./usage-limit-email.tsx";

/**
 * Every transactional message LangWatch sends, in one list.
 *
 * This is the discovery surface. The preview studio reads it and needs to know
 * nothing else; a person asking "what do we actually send people?" reads it and
 * gets a complete answer rather than a directory listing they have to open one
 * file at a time.
 *
 * A template file that is not listed here is invisible to both, which is why
 * `__tests__/registry.unit.test.ts` walks `src/templates/*.tsx` and fails when
 * one is missing. Adding a message is: schema, fixture, subject, component,
 * `defineTemplate`, and one line below.
 *
 * The order is the order the studio shows: the messages somebody receives
 * before they have an account, then the ones an admin receives, then the ones
 * the product sends about how it is being used.
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
  licenseEmailTemplate,
  budgetIncreaseRequestEmailTemplate,
  usageLimitEmailTemplate,
  automationLimitEmailTemplate,
  triggerDigestEmailTemplate,
];

export { defineTemplate, propsFormSchema, renderMailTemplate } from "./registry.ts";
export type { MailFixture, MailTemplate } from "./registry.ts";
