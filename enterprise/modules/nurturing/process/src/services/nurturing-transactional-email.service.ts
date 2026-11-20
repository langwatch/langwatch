// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import type {
  TransactionalEmail,
  TransactionalEmailOutcome,
} from "@langwatch/enterprise-nurturing-contract";
import { createLogger } from "@langwatch/observability";
import type { UserApi } from "@langwatch/user-contract";

import {
  type CustomerIoTransactionalChannel,
  CustomerIoTransactionalError,
  type CustomerIoTransactionalRequest,
} from "../channels/customer-io-transactional.channel.ts";

const logger = createLogger("langwatch:nurturing:transactional-email");

/**
 * Customer.io's transactional email, answered rather than thrown: whoever asked keeps its own
 * mailer and decides what a refusal means. Without the App API key every send is `off`.
 *
 * Customer.io bills per profile, and nurturing's own sync creates each user's person under the
 * user id; an address-only send for that user would open a second one. So an address that
 * belongs to a user is filed under the id, and any other (an invitee) stays by address.
 */
export class NurturingTransactionalEmailService {
  static create({
    channel,
    users,
  }: {
    channel: CustomerIoTransactionalChannel | undefined;
    users: Pick<UserApi, "findByEmail">;
  }): NurturingTransactionalEmailService {
    return new NurturingTransactionalEmailService(channel, users);
  }

  private constructor(
    private readonly channel: CustomerIoTransactionalChannel | undefined,
    private readonly users: Pick<UserApi, "findByEmail">,
  ) {}

  async send(email: TransactionalEmail): Promise<TransactionalEmailOutcome> {
    if (!this.channel) return { outcome: "off" };
    try {
      const { deliveryId } = await this.channel.send(await this.identified(email));
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

  private async identified(email: TransactionalEmail): Promise<CustomerIoTransactionalRequest> {
    try {
      const user = await this.users.findByEmail({ email: email.identifiers.email });
      return user ? { ...email, identifiers: { id: user.id } } : email;
    } catch (error) {
      // Delivery matters more than profile tidiness: a failed lookup sends by address, at worst
      // opening a duplicate person. Only the error class is logged: the address is personal data.
      logger.warn(
        { errorName: error instanceof Error ? error.name : typeof error },
        "user lookup failed; sending the transactional email by address",
      );
      return email;
    }
  }
}
