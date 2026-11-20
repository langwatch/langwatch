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

/**
 * What reaches Customer.io: the caller's message, filed under the person nurturing already
 * created (`id`, the LangWatch user id) or, for an address with no account, under the address.
 */
export type CustomerIoTransactionalRequest = Omit<TransactionalEmail, "identifiers"> & {
  identifiers: { id: string } | { email: string };
};

/** Customer.io's transactional email API: hands one rendered message over, or throws. */
export abstract class CustomerIoTransactionalChannel {
  abstract send(email: CustomerIoTransactionalRequest): Promise<{ deliveryId: string }>;
}
