import { isIP } from "node:net";

import { findWebhookUrlProblem, type WebhookUrlProblem } from "@langwatch/automation-contract";
import { DispatchError } from "@langwatch/eventing";

import {
  createSsrfUrlValidator,
  isPrivateOrLocalhostIP,
  type SsrfUrlValidator,
} from "../ssrf/url-validator.ts";

/**
 * The one admission policy for a customer-supplied webhook destination:
 * https-only, default port, no credentials, and private/loopback/link-local
 * blocked — `allowInsecureLocal` relaxes only origin and that block, nothing else.
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
  return findWebhookUrlProblem(url, { allowInsecureOrigin: allowInsecureLocal });
}

/** The host unbracketed, if it was written as a bracketed IPv6 literal. */
function unbracketedHost(host: string): string {
  if (!host.startsWith("[")) return host;
  if (!host.endsWith("]")) return host;
  return host.slice(1, -1);
}

/**
 * If the URL's host is an IP literal that is private/loopback/link-local,
 * return it unbracketed; else null. `isIP` rejects bracketed IPv6, so without
 * stripping, a private `[::1]` would wrongly fail as RETRYABLE instead of this terminal block.
 */
function privateIpLiteral(url: string): string | null {
  let host: string;
  try {
    host = new URL(url).hostname;
  } catch {
    return null;
  }
  const bare = unbracketedHost(host);
  if (isIP(bare) === 0) return null;
  if (!isPrivateOrLocalhostIP(bare)) return null;
  return bare;
}

/**
 * Terminally blocks what the webhook channels refuse pre-connection: a
 * failed shape check, or a private/loopback IP literal (bracketed IPv6
 * included). The send's own validator blocks the same host, but retryably.
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
