import { isIP } from "node:net";
import {
  sanitizeWebhookHeaders,
  validateWebhookUrlShape,
  WEBHOOK_HEADER_VALUE_KEPT,
  type WebhookMethod,
} from "~/automations/providers/definitions/webhook/shared";
import { DispatchError } from "~/server/event-sourcing/outbox/dispatchError";
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
   *  X-LangWatch-Test-Fire header (ADR-040 §1). */
  testFire?: boolean;
}

export interface WebhookSendResult {
  status: number;
  /** Response snippet, already size-capped by the HTTP utility. */
  body: string;
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
  // An unresolved kept sentinel means "the saved value" and should have been
  // resolved by the caller (save / test-fire / decrypt-at-dispatch) — never
  // send the literal marker to the customer's endpoint.
  const resolvedHeaders = Object.fromEntries(
    Object.entries(headers).filter(
      ([, value]) => value !== WEBHOOK_HEADER_VALUE_KEPT,
    ),
  );
  return sendHttpDestination({
    url,
    method,
    headers: {
      ...sanitizeWebhookHeaders(resolvedHeaders),
      "Content-Type": "application/json",
      ...(testFire ? { "X-LangWatch-Test-Fire": "true" } : {}),
    },
    body,
    contextLabel: label,
    validateUrl: validateWebhookUrl,
  });
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
  result: WebhookSendResult;
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
  });
}
