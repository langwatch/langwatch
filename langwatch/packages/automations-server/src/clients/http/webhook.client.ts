import { randomUUID } from "node:crypto";
import { isIP } from "node:net";
import {
  sanitizeWebhookHeaders,
  validateWebhookUrlShape,
  WEBHOOK_HEADER_VALUE_KEPT,
  type WebhookMethod,
} from "@langwatch/automations/providers/webhook";
import { DispatchError } from "@langwatch/dispatch-error";
import { classify } from "@langwatch/ssrf";
import { sendHttpDestination, type HttpEgress } from "./destination";

/** Per-window counter port the app backs with Redis (`~/server/rateLimit`). */
export type RateLimitPort = (params: {
  key: string;
  windowSeconds: number;
  max: number;
}) => Promise<{ allowed: boolean; resetAt: number }>;

/**
 * If the URL's host is an IP literal that is private / loopback / link-local,
 * return it (brackets stripped); else null. `new URL(...).hostname` keeps IPv6
 * in brackets, which `isIP` rejects — so a bracketed `[::1]` would otherwise
 * slip past the validator's IP-literal check and fail as an unresolvable
 * hostname (a *retryable* error) rather than a terminal block. This closes
 * that gap terminally at the webhook layer without forking `ssrfProtection`.
 */
function privateIpLiteral(url: string): string | null {
  let host: string;
  try {
    host = new URL(url).hostname;
  } catch {
    return null;
  }
  const bare =
    host.startsWith("[") && host.endsWith("]") ? host.slice(1, -1) : host;
  return isIP(bare) !== 0 && classify(bare) !== "global" ? bare : null;
}

/**
 * Per-project hourly cap on real webhook dispatches (ADR-040 §4) — a backstop
 * against an immediate-cadence trigger firing per-match turning our worker
 * fleet into an outbound flood. A safety limit, not a billing knob; promote to
 * an env var if a customer legitimately needs a higher ceiling.
 */
export const WEBHOOK_DISPATCH_HOURLY_CAP = 1000;

export interface WebhookSendInput {
  url: string;
  method?: WebhookMethod;
  /** Customer-configured static headers; reserved keys are stripped here
   *  again (defense in depth over the save-time sanitize). */
  headers?: Record<string, string>;
  /** The rendered JSON body. */
  body: string;
  /** Woven into DispatchError messages and delivery logs. */
  triggerName: string;
  /** Marks the request as a drawer test fire via a non-suppressible
   *  X-LangWatch-Test-Fire header (ADR-040 §1). Test fires skip the
   *  per-project dispatch cap (they carry the drawer's per-user limit). */
  testFire?: boolean;
  /** The firing project — enables the per-project dispatch rate limit
   *  (ADR-040 §4). Omitted for a test fire. */
  projectId?: string;
  /** Stable per-dispatch identity, sent as `X-LangWatch-Event-Id` (ADR-040
   *  §5): every retry of the same logical fire reuses it so a receiver can
   *  dedupe. A fresh UUID is generated when absent (e.g. a test fire). */
  eventId?: string;
}

export interface WebhookSendResult {
  status: number;
  /** Response snippet, already size-capped by the HTTP utility. */
  body: string;
  /** Truncated response headers — debugging context for the delivery log. */
  responseHeaders?: Record<string, string>;
  /** Parsed `Retry-After` (ms) the receiver asked us to back off by. */
  retryAfterMs?: number;
  /** The `X-LangWatch-Event-Id` actually sent — surfaced for the delivery log. */
  eventId: string;
}

/**
 * Sends one webhook automation request (ADR-040) — the notify channel where
 * the CUSTOMER supplies the endpoint. Delivery goes through the shared
 * SSRF-fenced HTTP utility with the strict webhook validator; redirects are
 * not followed (see `HttpDestinationRequest.validateUrl`). The status is
 * returned for the caller to classify via {@link assertWebhookDelivered} —
 * the drawer's test fire wants the raw status to show the author, dispatch
 * wants the DispatchError.
 */
export interface WebhookSender {
  sendWebhook(input: WebhookSendInput): Promise<WebhookSendResult>;
}

/**
 * The webhook channel sender (ADR-040). The app injects its SSRF-fenced
 * egress, the Redis-backed rate limiter, and the strict webhook validator —
 * whose result type stays opaque here, exactly as in
 * {@link sendHttpDestination}. The validator must enforce ADR-040 §4:
 * private-IP / localhost blocking FORCED ON regardless of the global
 * BLOCK_LOCAL_HTTP_CALLS toggle.
 */
export function createWebhookSender<V>({
  egress,
  rateLimit,
  validateWebhookUrl,
}: {
  egress: HttpEgress<V>;
  rateLimit: RateLimitPort;
  validateWebhookUrl: (url: string) => Promise<V>;
}): WebhookSender {
  async function sendWebhook({
  url,
  method = "POST",
  headers = {},
  body,
  triggerName,
  testFire = false,
  projectId,
  eventId,
}: WebhookSendInput): Promise<WebhookSendResult> {
  const label = `Webhook for trigger "${triggerName}"`;
  const shapeProblem = validateWebhookUrlShape(url);
  if (shapeProblem) {
    throw new DispatchError({
      message: `${label}: ${shapeProblem}`,
      retryable: false,
    });
  }
  // Terminal-block a private/loopback IP literal (incl. bracketed IPv6) up
  // front — the SSRF validator below fails these closed too, but as a
  // retryable "unresolvable host" rather than the permanent block it is.
  const privateLiteral = privateIpLiteral(url);
  if (privateLiteral) {
    throw new DispatchError({
      message: `${label}: the destination "${privateLiteral}" is a private or loopback address, which is not allowed.`,
      retryable: false,
    });
  }
  // Per-project dispatch cap (ADR-040 §4) — a real fire only; test fires ride
  // the drawer's per-user limit. Over the cap throws RETRYABLE with a
  // Retry-After to the window reset: a legitimate burst backs off and drains,
  // a sustained flood dead-letters after the outbox's max attempts.
  if (projectId && !testFire) {
    const limit = await rateLimit({
      key: `webhook-dispatch:${projectId}`,
      windowSeconds: 3600,
      max: WEBHOOK_DISPATCH_HOURLY_CAP,
    });
    if (!limit.allowed) {
      throw new DispatchError({
        message: `${label}: project webhook dispatch cap (${WEBHOOK_DISPATCH_HOURLY_CAP}/hour) reached — backing off.`,
        retryable: true,
        retryAfterMs: Math.max(0, limit.resetAt - Date.now()),
      });
    }
  }
  // An unresolved kept sentinel means "the saved value" and should have been
  // resolved by the caller (save / test-fire / decrypt-at-dispatch) — never
  // send the literal marker to the customer's endpoint.
  const resolvedHeaders = Object.fromEntries(
    Object.entries(headers).filter(
      ([, value]) => value !== WEBHOOK_HEADER_VALUE_KEPT,
    ),
  );
  // Stable across retries when the caller supplies it (dispatch); a fresh id
  // for a test fire, which has no retries to dedupe.
  const resolvedEventId = eventId ?? randomUUID();
  const response = await sendHttpDestination({
    egress,
    url,
    method,
    headers: {
      ...sanitizeWebhookHeaders(resolvedHeaders),
      "Content-Type": "application/json",
      "X-LangWatch-Event-Id": resolvedEventId,
      ...(testFire ? { "X-LangWatch-Test-Fire": "true" } : {}),
    },
    body,
    contextLabel: label,
    validateUrl: validateWebhookUrl,
  });
  return { ...response, eventId: resolvedEventId };
  }

  return { sendWebhook };
}

/** How much of the receiver's response rides in an error message. */
const ERROR_SNIPPET_CHARS = 300;

/**
 * ADR-040 §5 retry-vs-terminal classification. 2xx returns; 5xx / 429 / 408
 * throw retryable (the outbox backs off and re-attempts); any other status —
 * including 3xx, which the strict sender refuses to follow — throws terminal,
 * because retrying a misconfigured endpoint just spams it.
 */
export function assertWebhookDelivered({
  result,
  triggerName,
}: {
  result: Pick<WebhookSendResult, "status" | "body" | "retryAfterMs">;
  triggerName: string;
}): void {
  const { status } = result;
  if (status >= 200 && status < 300) return;
  const snippet = result.body.slice(0, ERROR_SNIPPET_CHARS).trim();
  const retryable = status >= 500 || status === 429 || status === 408;
  throw new DispatchError({
    message:
      `Webhook for trigger "${triggerName}" received HTTP ${status}` +
      (snippet ? `: ${snippet}` : ""),
    retryable,
    // Honor the receiver's backpressure on a retryable status (ADR-040 §5);
    // the queue folds it into its backoff as a floor.
    retryAfterMs: retryable ? result.retryAfterMs : undefined,
  });
}
