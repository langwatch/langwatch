import { DispatchError, toDispatchError } from "@langwatch/eventing";

import type { SlackApiTransport } from "./slack.web-api-delivery.channel.ts";

/** A slow endpoint must not pin a worker slot for the life of the process. */
const REQUEST_TIMEOUT_MS = 10_000;
/** Enough of the answer to parse Slack's `ok` flag and its error code. */
const DEFAULT_MAX_RESPONSE_BYTES = 64 * 1024;

/**
 * The HTTPS call behind a Slack bot delivery. Uses constant endpoints (not
 * customer-supplied) and bounds response size to prevent memory exhaustion.
 */
export class SlackWebApiTransportAdapter implements SlackApiTransport {
  static create(options: { fetch?: typeof globalThis.fetch } = {}): SlackWebApiTransportAdapter {
    return new SlackWebApiTransportAdapter(options.fetch ?? globalThis.fetch);
  }

  private constructor(private readonly fetchImpl: typeof globalThis.fetch) {}

  async request(input: {
    url: string;
    method: "POST";
    headers: Record<string, string>;
    body: string;
    contextLabel: string;
    maxResponseBytes?: number;
  }): Promise<{ status: number; body: string }> {
    let response: Response;
    try {
      response = await this.fetchImpl(input.url, {
        method: input.method,
        headers: input.headers,
        body: input.body,
        redirect: "manual",
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (error) {
      // A transport failure is transient by nature — DNS, TLS, a timeout — so
      // the queue is allowed to try again. The label names the automation, not
      // the token the request carried.
      throw toDispatchError(error, { message: `${input.contextLabel}: request failed` });
    }

    if (response.status >= 300 && response.status < 400) {
      throw new DispatchError({
        message: `${input.contextLabel}: refused to follow a redirect away from the Slack API`,
        retryable: false,
      });
    }

    const body = await response.text();

    return {
      status: response.status,
      body: body.slice(0, input.maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES),
    };
  }
}
