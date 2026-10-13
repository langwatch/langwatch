// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * The address-fenced fetch every provider admin-API call in this module goes
 * through: `api.anthropic.com`, `api.openai.com`, Microsoft Graph, and the
 * Copilot Studio Dataverse endpoint. None of these destinations is customer
 * input, but the credentials on the request are, and a redirect that hopped
 * to an attacker-chosen host would hand the header to it. That is why every
 * call site below already refuses redirects (`followRedirects: false`) and
 * why the destination is still judged against the private/loopback/metadata
 * block rather than trusted on the strength of the constant it was built from.
 *
 * Composes `@langwatch/egress`'s two-step validate-then-fetch seam into the
 * one-call shape these services were written against, so none of them holds
 * its own copy of the policy.
 */

import {
  createSsrfUrlValidator,
  fetchValidatedDestination,
  type FencedFetchOptions,
  type SsrfUrlValidator,
} from "@langwatch/egress";

export interface SsrfSafeResponse {
  readonly ok: boolean;
  readonly status: number;
  readonly statusText: string;
  readonly headers: Pick<Headers, "get">;
  readonly body: { cancel(): Promise<void> } | null;
  json(): Promise<unknown>;
  text(): Promise<string>;
}

/** The local-address part of the fence; cloud metadata is refused whatever it says. */
export type GovernanceEgressPolicy = Readonly<{ blockLocal: boolean; allowedHosts: string[] }>;

/**
 * A validator judged by `policy`, except that a URL whose origin equals one of `exemptOrigins`
 * (a configured vendor base) may be local. Cloud metadata is refused for every origin.
 */
export function createGovernanceUrlValidator({
  policy,
  exemptOrigins = [],
}: {
  policy: GovernanceEgressPolicy;
  exemptOrigins?: readonly string[];
}): SsrfUrlValidator {
  const judged = createSsrfUrlValidator(policy);
  const exempt = createSsrfUrlValidator({ ...policy, blockLocal: false });
  return (url) => {
    return isExemptOrigin({ url, exemptOrigins }) ? exempt(url) : judged(url);
  };
}

function isExemptOrigin({
  url,
  exemptOrigins,
}: {
  url: string;
  exemptOrigins: readonly string[];
}): boolean {
  try {
    return exemptOrigins.includes(new URL(url).origin);
  } catch {
    return false;
  }
}

/** A fenced fetch judged by `policy`, as main's `ssrfSafeFetch` read BLOCK_LOCAL_HTTP_CALLS. */
export function createSsrfSafeFetch(
  policy: GovernanceEgressPolicy,
  { exemptOrigins }: { exemptOrigins?: readonly string[] } = {},
): (url: string, init: FencedFetchOptions) => Promise<SsrfSafeResponse> {
  const validate = createGovernanceUrlValidator({ policy, exemptOrigins });
  return async (url, init) => {
    const validated = await validate(url);
    return fetchValidatedDestination(validated, init, { rejectUnauthorized: true });
  };
}

/** The strict fence, for destinations that are never on the private network. */
export const ssrfSafeFetch = createSsrfSafeFetch({ blockLocal: true, allowedHosts: [] });
