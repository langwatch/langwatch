// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import type {
  TransactionalEmail,
  TransactionalEmailOutcome,
} from "@langwatch/enterprise-nurturing-contract";

import {
  type CustomerIoTransactionalChannel,
  CustomerIoTransactionalError,
} from "../channels/customer-io-transactional.channel.ts";

/**
 * Customer.io's transactional email, answered rather than thrown: whoever asked keeps its own
 * mailer and decides what a refusal means. Without the App API key every send is `off`.
 */
export class NurturingTransactionalEmailService {
  static create({
    channel,
  }: {
    channel: CustomerIoTransactionalChannel | undefined;
  }): NurturingTransactionalEmailService {
    return new NurturingTransactionalEmailService(channel);
  }

  private constructor(private readonly channel: CustomerIoTransactionalChannel | undefined) {}

  async send(email: TransactionalEmail): Promise<TransactionalEmailOutcome> {
    if (!this.channel) return { outcome: "off" };
    try {
      const { deliveryId } = await this.channel.send(email);
      return { outcome: "queued", deliveryId };
    } catch (error) {
      if (!(error instanceof CustomerIoTransactionalError)) throw error;
      return {
        outcome: "refused",
        reason: error.reason,
        ...(error.status === undefined ? {} : { status: error.status }),
      };
    }
  }
}
