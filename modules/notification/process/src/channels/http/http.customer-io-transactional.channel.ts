import { resolveProxyForHost } from "@langwatch/egress";
import { EnvHttpProxyAgent, fetch as undiciFetch } from "undici";

import { normalizeHeaders } from "../../rules/email-mime.rules.ts";
import {
  CustomerIoTransactionalChannel,
  CustomerIoTransactionalError,
  type CustomerIoTransactionalRequest,
} from "../customer-io-transactional.channel.ts";
import type { EmailOutboundProxyConfig } from "../email-delivery.channel.ts";

const API_HOSTS = { eu: "api-eu.customer.io", us: "api.customer.io" } as const;

/** Customer.io's accepted reply, read loosely: anything without a delivery id is unreadable. */
type SendReply = { delivery_id?: unknown } | null | undefined;

/**
 * Shorter than the Resend gateway's 30 s: a send that has not answered in 10 s falls back to
 * the own mailer, so the person still gets the message while the queue is not held up.
 */
export const CUSTOMER_IO_REQUEST_TIMEOUT_MS = 10_000;

/** Customer.io's App API, `POST /v1/send/email`, with an App API key as the bearer. */
export class HttpCustomerIoTransactionalChannel extends CustomerIoTransactionalChannel {
  static create(input: {
    apiKey: string;
    region: "us" | "eu" | undefined;
    outboundProxy: EmailOutboundProxyConfig;
  }): HttpCustomerIoTransactionalChannel {
    return new HttpCustomerIoTransactionalChannel(
      input.apiKey,
      API_HOSTS[input.region ?? "eu"],
      input.outboundProxy,
    );
  }

  private dispatcher: EnvHttpProxyAgent | undefined;

  private constructor(
    private readonly apiKey: string,
    private readonly host: string,
    private readonly outboundProxy: EmailOutboundProxyConfig,
  ) {
    super();
  }

  async send(request: CustomerIoTransactionalRequest): Promise<{ deliveryId: string }> {
    // Process-owned, as in the Resend gateway: one per send would pile up pools under a burst.
    this.dispatcher ??= proxyDispatcherFor(this.outboundProxy, this.host);
    const dispatcher = this.dispatcher;

    let response: Awaited<ReturnType<typeof undiciFetch>>;
    try {
      // undici's own fetch, not the global one, so the undici dispatcher above is accepted.
      response = await undiciFetch(`https://${this.host}/v1/send/email`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payloadOf(request)),
        signal: AbortSignal.timeout(CUSTOMER_IO_REQUEST_TIMEOUT_MS),
        ...(dispatcher ? { dispatcher } : {}),
      });
    } catch (error) {
      throw new CustomerIoTransactionalError(isTimeout(error) ? "timeout" : "network");
    }

    if (!response.ok) {
      // Not read: an error reply can echo the request, recipient included, and this is logged.
      // Cancelled so undici returns the connection to the pool.
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

  async close(): Promise<void> {
    const dispatcher = this.dispatcher;
    this.dispatcher = undefined;
    await dispatcher?.close();
  }
}

/**
 * `tracked: false` keeps our links as written: join-request links carry tokens, and a rewritten
 * link would pass them through Customer.io's click tracker. `send_to_unsubscribed` because these
 * are transactional: a person who left the marketing list still gets their own account's mail.
 */
function payloadOf(request: CustomerIoTransactionalRequest) {
  const headers = normalizeHeaders(request.headers);
  return {
    transactional_message_id: request.transactionalMessageId,
    identifiers: request.identifiers,
    to: request.to,
    from: request.from,
    subject: request.subject,
    body: request.body,
    ...(request.replyTo && { reply_to: request.replyTo }),
    ...(headers && { headers }),
    send_to_unsubscribed: true,
    tracked: false,
  };
}

/** `HTTPS_PROXY` and `NO_PROXY` as the Resend gateway reads them. */
function proxyDispatcherFor(
  proxyConfig: EmailOutboundProxyConfig,
  host: string,
): EnvHttpProxyAgent | undefined {
  if (!resolveProxyForHost(proxyConfig, host)) return undefined;
  return new EnvHttpProxyAgent({
    httpProxy: proxyConfig.httpProxy ?? "",
    httpsProxy: proxyConfig.httpsProxy ?? "",
    noProxy: proxyConfig.noProxy ?? "",
  });
}

/** `AbortSignal.timeout` rejects with a `TimeoutError`. */
function isTimeout(error: unknown): boolean {
  return error instanceof Error && error.name === "TimeoutError";
}
