import { randomUUID } from "node:crypto";
import { isIP } from "node:net";
import {
  sanitizeWebhookHeaders,
  validateWebhookUrlShape,
  WEBHOOK_HEADER_VALUE_KEPT,
  type WebhookMethod,
} from "@langwatch/automations/providers/webhook";
import { DispatchError } from "~/server/event-sourcing/queues/dispatchError";
import { rateLimit } from "~/server/rateLimit";
import {
  signWebhookPayload,
  WEBHOOK_SIGNATURE_HEADER,
} from "~/server/webhooks/signature";
import {
  createSSRFValidator,
  isPrivateOrLocalhostIP,
} from "~/utils/ssrfProtection";
import { sendHttpDestination } from "./httpDestination";

/**
 * The webhook channel's SSRF policy (ADR-040 §4): private-IP / localhost
 * blocking is FORCED ON regardless of the global BLOCK_LOCAL_HTTP_CALLS
 * toggle — a customer-supplied URL fired from our workers must never reach
 * `10.x` / `localhost`, even in deployments that relax the toggle for their
 * own internal integrations.
 */
const validateWebhookUrl = createSSRFValidator({
  blockLocal: true,
  allowedHosts: [],
});

/**
 * The deliberate escape hatch for local development and self-hosted
 * installs whose receivers live on internal hosts: relaxes ONLY the
 * local/private blocking, keeping every other SSRF property (no
 * redirects, size caps, timeouts). Callers may pass allowInsecureLocal
 * only when the operator set WEBHOOKS_UNSAFE_ALLOW_LOCAL_URLS=1; the
 * automations channel never does.
 */
const validateWebhookUrlRelaxed = createSSRFValidator({
  blockLocal: false,
  allowedHosts: [],
});

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
  return isIP(bare) !== 0 && isPrivateOrLocalhostIP(bare) ? bare : null;
}

/**
 * Terminally blocks the two destinations the webhook channel refuses before it
 * opens a connection: a URL that fails the shape check (scheme, port), and a
 * host that is a private / loopback IP literal, including bracketed IPv6. The
 * SSRF validator on the send itself fails both closed as well, but as a
 * retryable "unresolvable host" instead of the permanent block they are.
 * `allowInsecureLocal` skips both, matching the relaxed validator the same flag
 * selects for the send.
 */
function assertWebhookUrlAllowed({
  url,
  label,
  allowInsecureLocal,
}: {
  url: string;
  label: string;
  allowInsecureLocal: boolean;
}): void {
  const shapeProblem = allowInsecureLocal ? null : validateWebhookUrlShape(url);
  if (shapeProblem) {
    throw new DispatchError({
      message: `${label}: ${shapeProblem}`,
      retryable: false,
    });
  }
  const privateLiteral = allowInsecureLocal ? null : privateIpLiteral(url);
  if (privateLiteral) {
    throw new DispatchError({
      message: `${label}: the destination "${privateLiteral}" is a private or loopback address, which is not allowed.`,
      retryable: false,
    });
  }
}

/**
 * The outbound header set: the customer's static headers, sanitized again here
 * as defense in depth over the save-time sanitize, plus the LangWatch envelope
 * (event id, optional signature, delivery attempt, test-fire marker).
 */
function buildWebhookHeaders({
  headers,
  body,
  eventId,
  signingSecret,
  attempt,
  testFire,
}: {
  headers: Record<string, string>;
  body: string;
  eventId: string;
  signingSecret?: string;
  attempt?: number;
  testFire: boolean;
}): Record<string, string> {
  // An unresolved kept sentinel means "the saved value" and should have been
  // resolved by the caller (save / test-fire / decrypt-at-dispatch); never
  // send the literal marker to the customer's endpoint.
  const resolvedHeaders = Object.fromEntries(
    Object.entries(headers).filter(
      ([, value]) => value !== WEBHOOK_HEADER_VALUE_KEPT,
    ),
  );
  return {
    ...sanitizeWebhookHeaders(resolvedHeaders),
    "Content-Type": "application/json",
    "X-LangWatch-Event-Id": eventId,
    ...(signingSecret
      ? {
          [WEBHOOK_SIGNATURE_HEADER]: signWebhookPayload({
            secret: signingSecret,
            body,
            timestampSeconds: Math.floor(Date.now() / 1000),
          }),
        }
      : {}),
    ...(attempt !== undefined
      ? { "X-LangWatch-Delivery-Attempt": String(attempt) }
      : {}),
    ...(testFire ? { "X-LangWatch-Test-Fire": "true" } : {}),
  };
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
  /** Overrides the default `Webhook for trigger "<name>"` phrasing for
   *  callers that are not triggers (e.g. webhook-platform endpoints). */
  contextLabel?: string;
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
  /** Per-destination signing secret. When present the request carries
   *  `X-LangWatch-Signature: t=<unix>,v1=<hmac-sha256(secret, "<t>.<body>")>`
   *  (5-minute receiver tolerance documented). This is the signing ADR-040
   *  specified; any channel that stores a secret inherits it. */
  signingSecret?: string;
  /** 1-based delivery attempt, sent as `X-LangWatch-Delivery-Attempt` so
   *  receivers can distinguish first delivery from ladder retries. */
  attempt?: number;
  /** Relax the private/loopback block for this send. Only the webhook
   *  endpoints platform passes this, and only when the operator set
   *  WEBHOOKS_UNSAFE_ALLOW_LOCAL_URLS=1 (local dev / internal receivers). */
  allowInsecureLocal?: boolean;
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
export async function sendWebhook({
  url,
  method = "POST",
  headers = {},
  body,
  triggerName,
  testFire = false,
  projectId,
  eventId,
  signingSecret,
  attempt,
  contextLabel,
  allowInsecureLocal = false,
}: WebhookSendInput): Promise<WebhookSendResult> {
  const label = contextLabel ?? `Webhook for trigger "${triggerName}"`;
  assertWebhookUrlAllowed({ url, label, allowInsecureLocal });
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
  // Stable across retries when the caller supplies it (dispatch); a fresh id
  // for a test fire, which has no retries to dedupe.
  const resolvedEventId = eventId ?? randomUUID();
  const response = await sendHttpDestination({
    url,
    method,
    headers: buildWebhookHeaders({
      headers,
      body,
      eventId: resolvedEventId,
      signingSecret,
      attempt,
      testFire,
    }),
    body,
    contextLabel: label,
    validateUrl: allowInsecureLocal
      ? validateWebhookUrlRelaxed
      : validateWebhookUrl,
  });
  return { ...response, eventId: resolvedEventId };
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
