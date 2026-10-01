import { isIP } from "node:net";

import {
  createSsrfUrlValidator,
  isPrivateOrLocalhostIP,
  type SsrfUrlValidator,
} from "@langwatch/egress";
import { findWebhookUrlProblem } from "@langwatch/webhook-contract";

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

/** The host unbracketed, if it was written as a bracketed IPv6 literal. */
function unbracketedHost(host: string): string {
  if (!host.startsWith("[")) return host;
  if (!host.endsWith("]")) return host;
  return host.slice(1, -1);
}

/** What the URL's host is written as: a private address literal, or anything else. */
type HostAddress = { kind: "private-literal"; address: string } | { kind: "other" };

/**
 * Whether the URL's host is an IP literal that is private/loopback/link-local,
 * unbracketed. `isIP` rejects bracketed IPv6, so without stripping, a private
 * `[::1]` would wrongly fail as RETRYABLE instead of this terminal block.
 */
function describeHostAddress(url: string): HostAddress {
  let host: string;
  try {
    host = new URL(url).hostname;
  } catch {
    return { kind: "other" };
  }
  const bare = unbracketedHost(host);
  if (isIP(bare) === 0 || !isPrivateOrLocalhostIP(bare)) return { kind: "other" };
  return { kind: "private-literal", address: bare };
}

/** Whether a URL is admitted, or the sentence that says why not (without the caller's label). */
type WebhookUrlVerdict = { admitted: true } | { admitted: false; reason: string };

/**
 * Judges what the webhook channels refuse pre-connection: a failed shape
 * check, or a private/loopback IP literal (bracketed IPv6 included). The
 * send's own validator blocks the same host, but retryably.
 */
export function judgeWebhookUrl({
  url,
  allowInsecureLocal,
}: {
  url: string;
  allowInsecureLocal: boolean;
}): WebhookUrlVerdict {
  const problem = findWebhookUrlProblem(url, { allowInsecureOrigin: allowInsecureLocal });
  if (problem) return { admitted: false, reason: problem.message };
  if (allowInsecureLocal) return { admitted: true };
  const host = describeHostAddress(url);
  if (host.kind === "private-literal") {
    return {
      admitted: false,
      reason: `the destination "${host.address}" is a private or loopback address, which is not allowed.`,
    };
  }
  return { admitted: true };
}
