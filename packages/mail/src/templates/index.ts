import { automationLimitEmailTemplate } from "./automation-limit-email";
import { budgetIncreaseRequestEmailTemplate } from "./budget-increase-request-email";
import { inviteEmailTemplate } from "./invite-email";
import { inviteReRequestEmailTemplate } from "./invite-re-request-email";
import {
  domainAutoJoinedTemplate,
  joinRequestApprovedTemplate,
  joinRequestArrivedTemplate,
  joinRequestExpiredTemplate,
  joinRequestRejectedTemplate,
  joinRequestReminderTemplate,
} from "./join-request-emails";
import { licenseEmailTemplate } from "./license-email";
import type { MailTemplate } from "./registry";
import { resetPasswordEmailTemplate } from "./reset-password-email";
import { signUpVerificationEmailTemplate } from "./sign-up-verification-email";
import { triggerDigestEmailTemplate } from "./trigger-digest-email";
import { usageLimitEmailTemplate } from "./usage-limit-email";

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

export { defineTemplate, propsFormSchema, renderMailTemplate } from "./registry";
export type { MailFixture, MailTemplate } from "./registry";
