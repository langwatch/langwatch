import { extractEmailDomain, requestPathname } from "@langwatch/auth-contract";
import { z } from "zod";

import { refusedWith } from "./better-auth-error-code.rules.ts";
import { findConnectionIdsInPath, ssoRequestTargetSchema } from "./sso-request-target.rules.ts";

/** The SSO engine's refusals of an issuer's discovery document (`@better-auth/sso`). */
export const SSO_DISCOVERY_REFUSAL_CODES = [
  "discovery_timeout",
  "discovery_unexpected_error",
  "discovery_not_found",
  "discovery_invalid_url",
  "discovery_untrusted_origin",
  "discovery_private_host",
  "oidc_endpoint_redirect",
  "discovery_invalid_json",
  "discovery_incomplete",
  "issuer_mismatch",
  "unsupported_token_auth_method",
] as const;

/** What an administrator needs to find the connection that broke, and why. */
export interface SsoDiscoveryRefusal {
  path: string;
  code: string;
  reason: string;
  providerId?: string;
  domain?: string;
}

const refusalSchema = z.object({
  message: z.string(),
  body: z.object({ code: z.string() }),
});

/** The callback refuses by redirecting, with the reason in the address it redirects to. */
const redirectSchema = z.object({
  status: z.literal("FOUND"),
  headers: z.instanceof(Headers),
});

/**
 * The refusal an SSO request ended in, one or none: a 4xx with a discovery code at sign-in, or a
 * `discovery_failed` redirect at the OIDC callback. Both reach only the browser otherwise.
 */
export function findSsoDiscoveryRefusals({
  url,
  body,
  returned,
}: {
  url: string;
  body: unknown;
  returned: unknown;
}): SsoDiscoveryRefusal[] {
  const path = requestPathname(url);
  if (path.endsWith("/sign-in/sso")) {
    if (!refusedWith(returned, SSO_DISCOVERY_REFUSAL_CODES)) return [];
    const refusal = refusalSchema.safeParse(returned).data;
    const target = ssoRequestTargetSchema.safeParse(body).data;
    return [
      {
        path,
        code: refusal?.body.code ?? "discovery_refused",
        reason: refusal?.message ?? "",
        providerId: target?.providerId,
        domain: target?.domain ?? extractEmailDomain(target?.email) ?? undefined,
      },
    ];
  }
  const [providerId] = findConnectionIdsInPath(url);
  const redirect = redirectSchema.safeParse(returned).data;
  if (!path.includes("/sso/callback/") || !redirect) return [];
  const location = URL.parse(redirect.headers.get("location") ?? "", "https://callback.invalid");
  if (location?.searchParams.get("error") !== "discovery_failed") return [];
  return [
    {
      path,
      code: "discovery_failed",
      reason: location.searchParams.get("error_description") ?? "",
      providerId,
    },
  ];
}
