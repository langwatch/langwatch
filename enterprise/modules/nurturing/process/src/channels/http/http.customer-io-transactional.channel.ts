// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import type { TransactionalEmail } from "@langwatch/enterprise-nurturing-contract";

import {
  CustomerIoTransactionalChannel,
  CustomerIoTransactionalError,
} from "../customer-io-transactional.channel.ts";

const API_HOSTS = { eu: "api-eu.customer.io", us: "api.customer.io" } as const;

/**
 * As the CDP channel's: a send that has not answered in 10 s is given up, so the caller's own
 * mailer still delivers it while the queue is not held up.
 */
export const CUSTOMER_IO_TRANSACTIONAL_TIMEOUT_MS = 10_000;

/** Customer.io's accepted reply, read loosely: anything without a delivery id is unreadable. */
type SendReply = { delivery_id?: unknown } | null | undefined;

/**
 * Customer.io's App API, `POST /v1/send/email`, with the App API key as the bearer. It reaches
 * the network the way the CDP channel does, through `fetch`, which a test replaces.
 */
export class HttpCustomerIoTransactionalChannel extends CustomerIoTransactionalChannel {
  static create(input: {
    apiKey: string;
    region: "us" | "eu" | undefined;
    fetchFn?: typeof fetch;
  }): HttpCustomerIoTransactionalChannel {
    return new HttpCustomerIoTransactionalChannel(
      input.apiKey,
      `https://${API_HOSTS[input.region ?? "eu"]}/v1/send/email`,
      input.fetchFn ?? fetch,
    );
  }

  private constructor(
    private readonly apiKey: string,
    private readonly url: string,
    private readonly fetchFn: typeof fetch,
  ) {
    super();
  }

  async send(email: TransactionalEmail): Promise<{ deliveryId: string }> {
    let response: Response;
    try {
      response = await this.fetchFn(this.url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payloadOf(email)),
        signal: AbortSignal.timeout(CUSTOMER_IO_TRANSACTIONAL_TIMEOUT_MS),
      });
    } catch (error) {
      throw new CustomerIoTransactionalError(isTimeout(error) ? "timeout" : "network");
    }

    if (!response.ok) {
      // Not read: an error reply can echo the request, recipient included, and this is logged.
      // Cancelled so the connection goes back to the pool.
      await response.body?.cancel().catch(() => void 0);
      throw new CustomerIoTransactionalError("status", response.status);
    }

    const reply = (await response.json().catch(() => undefined)) as SendReply;
    const deliveryId = reply?.delivery_id;
    if (typeof deliveryId !== "string" || deliveryId === "") {
      throw new CustomerIoTransactionalError("unreadable-reply", response.status);
    }
    return { deliveryId };
  }
}

/**
 * `tracked: false` keeps the links as written: join-request links carry tokens, and a rewritten
 * link would pass them through Customer.io's click tracker. `send_to_unsubscribed` because these
 * are transactional: a person who left the marketing list still gets their own account's mail.
 */
function payloadOf(email: TransactionalEmail) {
  return {
    transactional_message_id: email.transactionalMessageId,
    identifiers: email.identifiers,
    to: email.to,
    from: email.from,
    subject: email.subject,
    body: email.body,
    ...(email.replyTo && { reply_to: email.replyTo }),
    ...(email.headers && { headers: email.headers }),
    send_to_unsubscribed: true,
    tracked: false,
  };
}

/** `AbortSignal.timeout` rejects with a `TimeoutError`. */
function isTimeout(error: unknown): boolean {
  return error instanceof Error && error.name === "TimeoutError";
}
