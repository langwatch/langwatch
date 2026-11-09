// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import type { Instant } from "@langwatch/time";

/** One open recovery case, as the Subscription row's recovery columns hold it. */
export type PaymentRecoveryCase = {
  subscriptionId: string;
  organizationId: string;
  plan: string;
  stripeSubscriptionId: string | null;
  invoiceId: string;
  /** Day 0: the first failed charge of the invoice. */
  startedAt: Instant;
  /** The last notice sent (0, 3, 7, 14 or 21); null before the first. */
  noticeDay: number | null;
};

export type ClosePaymentRecoveryResult =
  | { outcome: "closed"; closed: PaymentRecoveryCase }
  | { outcome: "not_open" };

/**
 * The recovery columns on billing's Subscription row. Every write is conditional, so a
 * redelivered event or a second sweep finds the write already done and does nothing.
 */
export abstract class PaymentRecoveryRepository {
  /** Opens a case only when none is open on the row; true when this write opened it. */
  abstract open(input: {
    subscriptionId: string;
    invoiceId: string;
    startedAt: Instant;
  }): Promise<boolean>;

  /** Clears an open case, only for `invoiceId` when given; answers the case it closed. */
  abstract close(input: {
    subscriptionId: string;
    invoiceId?: string;
  }): Promise<ClosePaymentRecoveryResult>;

  /** Moves the last notice sent from `from` to `to`; true only for the write that moved it. */
  abstract advanceNotice(input: {
    subscriptionId: string;
    from: number | null;
    to: number;
  }): Promise<boolean>;

  /** Every open case, oldest first. */
  abstract findOpen(): Promise<PaymentRecoveryCase[]>;

  /** The open case on one subscription row, as a list of none or one. */
  abstract findOpenForSubscription(subscriptionId: string): Promise<PaymentRecoveryCase[]>;

  /** The open cases of one organization, oldest first. */
  abstract findOpenForOrganization(organizationId: string): Promise<PaymentRecoveryCase[]>;
}
