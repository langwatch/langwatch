/**
 * Microsoft Entra ID, recognised by its issuer.
 *
 * Entra ID signs in on one host (`login.microsoftonline.com`) and serves the
 * OpenID Connect userinfo endpoint its discovery document names on another
 * (`https://graph.microsoft.com/oidc/userinfo`). Each national cloud has its
 * own pair.
 */

/** Sign-in host to the Microsoft Graph origins that cloud's discovery
 *  document names for userinfo. */
const ENTRA_CLOUDS: ReadonlyMap<string, readonly string[]> = new Map([
  ["login.microsoftonline.com", ["https://graph.microsoft.com"]],
  ["login.windows.net", ["https://graph.microsoft.com"]],
  ["sts.windows.net", ["https://graph.microsoft.com"]],
  [
    "login.microsoftonline.us",
    ["https://graph.microsoft.us", "https://dod-graph.microsoft.us"],
  ],
  ["login.partner.microsoftonline.cn", ["https://microsoftgraph.chinacloudapi.cn"]],
  ["login.chinacloudapi.cn", ["https://microsoftgraph.chinacloudapi.cn"]],
]);

/** An https issuer's host and path. Parsed by hand: this package compiles
 *  without DOM or Node types, so `URL` is not available to it. */
const HTTPS_ISSUER = /^https:\/\/([^/?#]+)([^?#]*)$/i;

function partsOf(
  issuer: string | null | undefined,
): { host: string; path: string } | null {
  const match = issuer ? HTTPS_ISSUER.exec(issuer.trim()) : null;
  if (!match?.[1]) return null;
  return { host: match[1].toLowerCase(), path: match[2] ?? "" };
}

function hostOf(issuer: string | null | undefined): string | null {
  return partsOf(issuer)?.host ?? null;
}

/** Whether an OIDC issuer is Microsoft Entra ID. */
export function isEntraIssuer(issuer: string | null | undefined): boolean {
  const host = hostOf(issuer);
  return host !== null && ENTRA_CLOUDS.has(host);
}

/**
 * The origins besides the issuer's own that an Entra ID sign-in fetches
 * from: Microsoft Graph, where the userinfo endpoint lives. Empty for any
 * other issuer.
 */
export function entraEndpointOrigins(
  issuer: string | null | undefined,
): readonly string[] {
  const host = hostOf(issuer);
  return (host && ENTRA_CLOUDS.get(host)) || [];
}

/** The Entra ID v2 tenant issuer path: `/<tenant>/v2.0`. */
const V2_TENANT_PATH = /^\/([^/]+)\/v2\.0\/*$/;

/** The path segments Entra ID uses for its multi-tenant endpoints. Their
 *  discovery documents name the issuer as a `{tenantid}` template, which no
 *  token's `iss` ever equals. */
const MULTI_TENANT_SEGMENTS = new Set(["common", "organizations", "consumers"]);

/**
 * The issuer an Entra ID token carries, from the one an administrator typed.
 *
 * Entra ID v2 tokens name `https://login.microsoftonline.com/<tenant>/v2.0`
 * with no trailing slash, and v1 tokens name `https://sts.windows.net/<tenant>/`
 * with exactly one. The token's `iss` is compared to the stored issuer
 * character for character, so a slash pasted on or left off refuses every
 * sign-in. Any other issuer is returned unchanged: Auth0's, for one, does
 * end in a slash.
 */
export function canonicalEntraIssuer(issuer: string): string {
  const parts = partsOf(issuer);
  if (parts === null || !ENTRA_CLOUDS.has(parts.host)) return issuer;
  const origin = `https://${parts.host}`;
  const v2 = V2_TENANT_PATH.exec(parts.path);
  if (v2) return `${origin}/${v2[1]}/v2.0`;
  if (parts.host === "sts.windows.net") {
    const tenant = parts.path.replace(/^\/+|\/+$/g, "");
    if (tenant !== "" && !tenant.includes("/")) {
      return `${origin}/${tenant}/`;
    }
  }
  return issuer;
}

/**
 * The multi-tenant segment (`common`, `organizations`, `consumers`) an Entra
 * ID issuer names instead of a tenant, or null.
 */
export function entraMultiTenantSegment(issuer: string): string | null {
  const parts = partsOf(issuer);
  if (parts === null || !ENTRA_CLOUDS.has(parts.host)) return null;
  const first = parts.path.split("/").filter(Boolean)[0];
  return first && MULTI_TENANT_SEGMENTS.has(first.toLowerCase())
    ? first.toLowerCase()
    : null;
}
