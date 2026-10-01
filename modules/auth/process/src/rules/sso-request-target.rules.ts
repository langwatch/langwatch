import { requestPathname } from "@langwatch/auth-contract";
import { z } from "zod";

/**
 * Which connection a single sign-on request is about, read off the request
 * itself. Pure: the reading is here, the asking is the service's.
 */

/**
 * Whether this request could need an issuer fetched at all. Matched on the
 * segment rather than an enumeration of routes, which would go stale the
 * first time one of them was renamed.
 */
export function isSingleSignOnPath(url: string | undefined): boolean {
  if (!url) return false;
  return requestPathname(url).includes("/sso");
}

/**
 * The connection ids the path names — one, or none. `/sso/callback/:id` and
 * `/sso/saml2/sp/acs/:id` both carry it, and for us a provider id IS a
 * connection id: the engine's row is keyed on it.
 */
export function findConnectionIdsInPath(url: string): string[] {
  const pathname = requestPathname(url);
  const match =
    /\/sso\/callback\/([^/?#]+)/.exec(pathname) ??
    /\/sso\/saml2\/sp\/acs\/([^/?#]+)/.exec(pathname);
  const connectionId = match?.[1];
  return connectionId ? [connectionId] : [];
}

/** What a sign-in body may name its target by. Everything else is ignored. */
export const ssoRequestTargetSchema = z.object({
  providerId: z.string().min(1).optional(),
  domain: z.string().min(1).optional(),
  email: z.string().optional(),
});

export type SsoRequestTarget = z.infer<typeof ssoRequestTargetSchema>;
