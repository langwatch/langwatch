// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import type { BillingFixedEmailProps } from "@langwatch/mail";

/** One billing-fixed email, as billing hands it to the mail composition. */
export type BillingFixedEmail = BillingFixedEmailProps;

/**
 * The mail to an admin whose refused seat change can be finished now. Envelope, template and
 * sender belong to the mail composition, hence a channel; the memory tier records it.
 */
export abstract class BillingFixedEmailChannel {
  abstract send(input: { to: string; email: BillingFixedEmail }): Promise<void>;
}
