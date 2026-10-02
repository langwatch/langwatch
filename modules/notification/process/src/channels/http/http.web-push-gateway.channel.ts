import {
  createSsrfUrlValidator,
  fetchValidatedDestination,
  type SsrfUrlValidator,
} from "@langwatch/egress";
import { DispatchError, parseRetryAfterMs } from "@langwatch/eventing";

import type {
  WebPushGateway,
  WebPushRequest,
  WebPushResponse,
} from "../web-push-gateway.channel.ts";

/** A push service answers in well under a second; a stalled one is retried later. */
const PUSH_TIMEOUT_MS = 15_000;

/** The egress fence refusing an address is the endpoint's shape, not a blip. */
const FENCE_REFUSAL =
  /ssrf|blocked|not allowed|private|loopback|metadata|link-local|disallowed|redirects are not followed/i;

/**
 * Sends through the egress fence: the endpoint came from a browser, so it is resolved and
 * pinned like any customer-supplied URL, private addresses are refused, and redirects are
 * not followed.
 */
export class HttpWebPushGatewayChannel implements WebPushGateway {
  static create(): HttpWebPushGatewayChannel {
    return new HttpWebPushGatewayChannel(
      createSsrfUrlValidator({ blockLocal: true, allowedHosts: [] }),
    );
  }

  private constructor(private readonly validateUrl: SsrfUrlValidator) {}

  async send(request: WebPushRequest): Promise<WebPushResponse> {
    try {
      const validated = await this.validateUrl(request.endpoint);
      const response = await fetchValidatedDestination(
        validated,
        {
          method: "POST",
          headers: { ...request.headers },
          body: new Uint8Array(request.body),
          signal: AbortSignal.timeout(PUSH_TIMEOUT_MS),
          headersTimeoutMs: PUSH_TIMEOUT_MS,
          bodyTimeoutMs: PUSH_TIMEOUT_MS,
          followRedirects: false,
        },
        { rejectUnauthorized: true },
      );
      await response.body?.cancel().catch(() => undefined);
      const retryAfterMs = parseRetryAfterMs(response.headers.get("retry-after"));
      return retryAfterMs === undefined
        ? { status: response.status }
        : { status: response.status, retryAfterMs };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new DispatchError({
        message: `Web Push: the push service could not be reached: ${message}`,
        retryable: !FENCE_REFUSAL.test(message),
        cause: error,
      });
    }
  }
}
