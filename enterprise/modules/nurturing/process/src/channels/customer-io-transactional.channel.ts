// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import type {
  TransactionalEmail,
  TransactionalEmailRefusal,
} from "@langwatch/enterprise-nurturing-contract";

/**
 * A send Customer.io did not accept. Carries the reply status and a reason class only: the
 * request holds a recipient address and the client holds the key, and this is logged.
 */
export class CustomerIoTransactionalError extends Error {
  constructor(
    readonly reason: TransactionalEmailRefusal,
    readonly status?: number,
  ) {
    super(
      status === undefined
        ? `Customer.io transactional send failed (${reason})`
        : `Customer.io transactional send failed (${reason} ${status})`,
    );
    this.name = "CustomerIoTransactionalError";
  }
}

/** Customer.io's transactional email API: hands one rendered message over, or throws. */
export abstract class CustomerIoTransactionalChannel {
  abstract send(email: TransactionalEmail): Promise<{ deliveryId: string }>;
}
