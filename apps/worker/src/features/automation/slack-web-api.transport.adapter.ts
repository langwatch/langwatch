import type { SlackApiTransport } from "@langwatch/automation-server";
import { DispatchError, toDispatchError } from "@langwatch/eventing";

/** A slow endpoint must not pin a worker slot for the life of the process. */
const REQUEST_TIMEOUT_MS = 10_000;
/** Enough of the answer to parse Slack's `ok` flag and its error code. */
const DEFAULT_MAX_RESPONSE_BYTES = 64 * 1024;

/**
 * The HTTPS call behind a Slack bot delivery.
 *
 * Both destinations `SlackWebApiDeliveryAdapter` uses are constants compiled
 * into that adapter — `slack.com/api/chat.postMessage` and
 * `slack.com/api/conversations.list`. Nothing a customer supplies reaches this
 * transport, which is why it is a plain fetch rather than the application's
 * SSRF-fenced sender: there is no address here for a customer to point
 * anywhere.
 *
 * Redirects are refused rather than followed. A 3xx from this host would mean
 * the endpoint is not the Slack that was compiled in, and the request carries
 * a customer's bot token — precisely the case where it must not be re-sent.
 *
 * The response is read up to a bound. A hostile or broken endpoint answering
 * with an endless body would otherwise stream into memory, and everything this
 * caller needs is in the first few hundred bytes.
 */
export class WorkerSlackWebApiTransportAdapter implements SlackApiTransport {
  static create(
    options: { fetch?: typeof globalThis.fetch } = {},
  ): WorkerSlackWebApiTransportAdapter {
    return new WorkerSlackWebApiTransportAdapter(options.fetch ?? globalThis.fetch);
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
