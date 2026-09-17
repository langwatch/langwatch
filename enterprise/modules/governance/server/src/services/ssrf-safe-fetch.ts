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
} from "@langwatch/egress";

const validate = createSsrfUrlValidator({ blockLocal: true, allowedHosts: [] });

// The return type is undici's Response, not the DOM's, and it is left to
// inference so it stays whatever the egress seam actually hands back.
export async function ssrfSafeFetch(url: string, init: FencedFetchOptions) {
  const validated = await validate(url);

  return fetchValidatedDestination(validated, init, { rejectUnauthorized: true });
}
