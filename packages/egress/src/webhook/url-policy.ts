import { isIP } from "node:net";
import { inspectWebhookUrlShape, type WebhookUrlProblem } from "@langwatch/automation-contract";
import { DispatchError } from "@langwatch/eventing";
import {
  createSsrfUrlValidator,
  isPrivateOrLocalhostIP,
  type SsrfUrlValidator,
} from "../ssrf/url-validator";

/**
 * The one admission policy for a customer-supplied webhook destination, shared
 * by the automations channel and the webhook endpoints platform.
 *
 * The two channels used to admit different URLs. Automations refused anything
 * that was not https on the default port with no credentials, and blocked
 * private addresses unconditionally; the platform only asked for https. Same
 * threat, same senders, two answers — so a URL the trigger drawer rejected was
 * accepted as an endpoint, and `https://internal:6379` was a live port probe on
 * one channel and a rejected one on the other.
 *
 * This module is the UNION of the two, so the answer is the stricter one
 * everywhere:
 *
 *   - https only, on the default port, with a real host
 *   - no credentials in the URL, ever
 *   - private / loopback / link-local destinations blocked, regardless of any
 *     deployment-wide local-address toggle: a customer-supplied URL fired from
 *     our workers must never reach `10.x` or `localhost`, even where an
 *     operator relaxed that toggle for their own internal integrations
 *
 * `allowInsecureLocal` is the single escape hatch, for local development and
 * self-hosted installs whose receivers live on internal hosts. It relaxes the
 * origin (scheme and port) and the local-address block; it relaxes nothing else
 * — no redirects, no size or timeout budget, and no credentials.
 *
 * FROZEN TWIN of `platform/app/src/server/webhooks/urlPolicy.ts`. The shape
 * half is not re-implemented but IMPORTED from `@langwatch/automation-contract`,
 * the same `inspectWebhookUrlShape` the authoring drawer validates with: a
 * second copy of these rules is exactly how a URL comes to be accepted by the
 * form and refused by the sender.
 *
 * WHAT DID NOT COME ACROSS: the application reads its escape hatch from
 * `WEBHOOKS_UNSAFE_ALLOW_LOCAL_URLS === "1"` at call time. A package reads no
 * environment, so the hatch is a parameter and the caller states it. The
 * automations channel never passes it — only the endpoints platform does, which
 * is why the graph-alert transport is always strict.
 */

const strictValidator = createSsrfUrlValidator({ blockLocal: true, allowedHosts: [] });

const relaxedValidator = createSsrfUrlValidator({ blockLocal: false, allowedHosts: [] });

/**
 * The address validator for a send. Passing it to the HTTP destination also
 * refuses redirects, because a hop is an address this admission never judged.
 */
export function webhookUrlValidator(allowInsecureLocal: boolean): SsrfUrlValidator {
  return allowInsecureLocal ? relaxedValidator : strictValidator;
}

/**
 * The shape half of the policy: scheme, host, port, credentials. Returns the
 * broken rule as a code plus the automations channel's author-facing sentence;
 * the endpoints REST API maps the code to its own wording.
 */
export function inspectWebhookUrl({
  url,
  allowInsecureLocal,
}: {
  url: string;
  allowInsecureLocal: boolean;
}): WebhookUrlProblem | null {
  return inspectWebhookUrlShape(url, { allowInsecureOrigin: allowInsecureLocal });
}

/**
 * If the URL's host is an IP literal that is private / loopback / link-local,
 * return it (brackets stripped); else null.
 *
 * `new URL(...).hostname` keeps IPv6 in brackets, which `isIP` rejects — so a
 * bracketed `[::1]` would otherwise slip past the validator's IP-literal check
 * and fail as an unresolvable hostname (a RETRYABLE error) rather than the
 * terminal block it is. This closes that gap at the webhook layer without
 * forking the address classifier.
 */
function privateIpLiteral(url: string): string | null {
  let host: string;
  try {
    host = new URL(url).hostname;
  } catch {
    return null;
  }
  const bare = host.startsWith("[") && host.endsWith("]") ? host.slice(1, -1) : host;
  return isIP(bare) !== 0 && isPrivateOrLocalhostIP(bare) ? bare : null;
}

/**
 * Terminally blocks the destinations the webhook channels refuse before they
 * open a connection: a URL that fails the shape check, and a host that is a
 * private / loopback IP literal, including bracketed IPv6. The address
 * validator on the send itself fails both closed as well, but as a retryable
 * "unresolvable host" instead of the permanent block they are.
 */
export function assertWebhookUrlAllowed({
  url,
  label,
  allowInsecureLocal,
}: {
  url: string;
  label: string;
  allowInsecureLocal: boolean;
}): void {
  const problem = inspectWebhookUrl({ url, allowInsecureLocal });
  if (problem) {
    throw new DispatchError({
      message: `${label}: ${problem.message}`,
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
