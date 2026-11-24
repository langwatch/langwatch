// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import { createHash } from "node:crypto";

import { createLogger } from "@langwatch/observability";

import {
  CustomerIoTransactionalChannel,
  CustomerIoTransactionalError,
  type CustomerIoTransactionalRequest,
} from "../customer-io-transactional.channel.ts";

const API_HOSTS = { eu: "api-eu.customer.io", us: "api.customer.io" } as const;

const logger = createLogger("langwatch:nurturing:customer-io-transactional");

/**
 * As the CDP channel's: a send that has not answered in 10 s is given up, so the caller's own
 * mailer still delivers it while the queue is not held up.
 */
export const CUSTOMER_IO_TRANSACTIONAL_TIMEOUT_MS = 10_000;

/** Customer.io's accepted reply, read loosely: a 2xx counts as queued whatever its body says. */
type SendReply = { delivery_id?: unknown } | null | undefined;

/**
 * Customer.io's App API, `POST /v1/send/email`, with the App API key as the bearer. It reaches
 * the network the way the CDP channel does, through `fetch`, which a test replaces.
 */
export class HttpCustomerIoTransactionalChannel extends CustomerIoTransactionalChannel {
  static create(input: {
    apiKey: string;
    region: "us" | "eu" | undefined;
    /** Replaces `https://<regional host>`, e.g. a local stub. */
    baseUrl?: string | undefined;
    fetchFn?: typeof fetch;
  }): HttpCustomerIoTransactionalChannel {
    const baseUrl = input.baseUrl ?? `https://${API_HOSTS[input.region ?? "eu"]}`;
    return new HttpCustomerIoTransactionalChannel(
      input.apiKey,
      `${baseUrl}/v1/send/email`,
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

  async send(email: CustomerIoTransactionalRequest): Promise<{ deliveryId?: string }> {
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
    if (typeof deliveryId === "string" && deliveryId !== "") return { deliveryId };
    // A 2xx means Customer.io queued it; refusing here would make the caller's own mailer send a
    // second copy. The line carries enough to find the mail later, never the address or the key.
    logger.warn(
      {
        template: email.transactionalMessageId,
        recipientHash: recipientHashOf(email.to),
        status: response.status,
      },
      "Customer.io queued a transactional email but its reply held no delivery id",
    );
    return {};
  }
}

/**
 * `tracked: false` keeps the links as written, so no click passes through Customer.io's click
 * tracker. `send_to_unsubscribed` because these
 * are transactional: a person who left the marketing list still gets their own account's mail.
 */
function payloadOf(email: CustomerIoTransactionalRequest) {
  return {
    transactional_message_id: email.transactionalMessageId,
    identifiers: email.identifiers,
    to: email.to,
    from: email.from,
    subject: literalUnderLiquid(email.subject),
    body: literalUnderLiquid(email.body),
    ...(email.replyTo && { reply_to: email.replyTo }),
    ...(email.headers && { headers: email.headers }),
    send_to_unsubscribed: true,
    tracked: false,
  };
}

/**
 * Customer.io renders Liquid in a subject and body passed with the send (its own `auto_create`
 * example puts `{{customer.first_name}}` in one), and has no switch to turn that off. Ours are
 * finished text that carries user-set names (an organization, a trigger), so every Liquid opener
 * is printed as a Liquid string literal: the reader sees the text as typed, nothing is evaluated.
 * One pass, so the `{{` each replacement adds is not itself replaced.
 */
function literalUnderLiquid(text: string): string {
  return text.replace(/\{[{%]/g, (opener) => `{{ "${opener}" }}`);
}

/**
 * A short sha256 of the recipient as handed over, as automation hashes its recipients: it
 * matches a known address to a log line without the line holding the address.
 */
function recipientHashOf(recipient: string): string {
  return createHash("sha256").update(recipient).digest("hex").slice(0, 16);
}

/** `AbortSignal.timeout` rejects with a `TimeoutError`. */
function isTimeout(error: unknown): boolean {
  return error instanceof Error && error.name === "TimeoutError";
}
