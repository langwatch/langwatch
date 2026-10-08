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
function partsOf(
  issuer: string | null | undefined,
): { host: string; path: string } | null {
  const value = issuer?.trim() ?? "";
  if (value.slice(0, 8).toLowerCase() !== "https://") return null;
  const rest = value.slice(8);
  const queryAt = rest.search(/[?#]/);
  const address = queryAt === -1 ? rest : rest.slice(0, queryAt);
  const pathAt = address.indexOf("/");
  const host = pathAt === -1 ? address : address.slice(0, pathAt);
  if (host === "") return null;
  return {
    host: host.toLowerCase(),
    path: pathAt === -1 ? "" : address.slice(pathAt),
  };
}

/** The path segments, without empty ones from repeated or edge slashes. */
function segmentsOf(path: string): string[] {
  return path.split("/").filter((segment) => segment !== "");
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
  const segments = segmentsOf(parts.path);
  // The v2 tenant issuer, `/<tenant>/v2.0`, carries no trailing slash.
  if (segments.length === 2 && segments[1] === "v2.0") {
    return `${origin}/${segments[0]}/v2.0`;
  }
  // The v1 issuer, `https://sts.windows.net/<tenant>/`, carries exactly one.
  if (parts.host === "sts.windows.net" && segments.length === 1) {
    return `${origin}/${segments[0]}/`;
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
  const first = segmentsOf(parts.path)[0];
  return first && MULTI_TENANT_SEGMENTS.has(first.toLowerCase())
    ? first.toLowerCase()
    : null;
}
