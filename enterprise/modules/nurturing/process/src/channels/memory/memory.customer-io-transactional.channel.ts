// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import type { TransactionalEmailRefusal } from "@langwatch/enterprise-nurturing-contract";

import {
  CustomerIoTransactionalChannel,
  CustomerIoTransactionalError,
  type CustomerIoTransactionalRequest,
} from "../customer-io-transactional.channel.ts";

/** How a scripted send fails, as the HTTP client reports each kind. */
export type CustomerIoScriptedFailure = Readonly<{
  reason: TransactionalEmailRefusal;
  status?: number;
}>;

/**
 * Records every email it is handed, accepted or not, so a test reads back what would have
 * reached Customer.io. Told to fail, it refuses the way the HTTP client refuses.
 */
export class MemoryCustomerIoTransactionalChannel extends CustomerIoTransactionalChannel {
  static create(): MemoryCustomerIoTransactionalChannel {
    return new MemoryCustomerIoTransactionalChannel();
  }

  readonly sent: CustomerIoTransactionalRequest[] = [];

  private failure: CustomerIoScriptedFailure | undefined;

  private constructor() {
    super();
  }

  /** Every send fails this way from now on. */
  failWith(failure: CustomerIoScriptedFailure): this {
    this.failure = failure;
    return this;
  }

  async send(email: CustomerIoTransactionalRequest): Promise<{ deliveryId: string }> {
    this.sent.push(email);
    if (this.failure) {
      throw new CustomerIoTransactionalError(this.failure.reason, this.failure.status);
    }
    return { deliveryId: `delivery-${this.sent.length}` };
  }
}
