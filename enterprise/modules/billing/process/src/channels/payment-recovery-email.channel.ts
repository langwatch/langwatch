// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import type { PaymentRecoveryEmailProps } from "@langwatch/mail";

/** One recovery email, as billing hands it to the mail composition. */
export type PaymentRecoveryEmail = PaymentRecoveryEmailProps;

/**
 * The failed payment recovery mail. Envelope, template and sender belong to the mail
 * composition, hence a channel; the memory tier records what it was handed.
 */
export abstract class PaymentRecoveryEmailChannel {
  abstract send(input: { to: string; email: PaymentRecoveryEmail }): Promise<void>;
}
