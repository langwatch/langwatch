/**
 * Microsoft Entra ID, recognised by its issuer. It signs in on one host and
 * names its userinfo endpoint on Microsoft Graph, another origin; each
 * national cloud has its own pair.
 */
const ENTRA_CLOUDS: ReadonlyMap<string, readonly string[]> = new Map([
  ["login.microsoftonline.com", ["https://graph.microsoft.com"]],
  ["login.windows.net", ["https://graph.microsoft.com"]],
  ["sts.windows.net", ["https://graph.microsoft.com"]],
  ["login.microsoftonline.us", ["https://graph.microsoft.us", "https://dod-graph.microsoft.us"]],
  ["login.partner.microsoftonline.cn", ["https://microsoftgraph.chinacloudapi.cn"]],
  ["login.chinacloudapi.cn", ["https://microsoftgraph.chinacloudapi.cn"]],
]);

/** Entra ID's multi-tenant segments: their discovery documents name a
 *  `{tenantid}` template as the issuer, which no token's `iss` equals. */
const MULTI_TENANT_SEGMENTS = new Set(["common", "organizations", "consumers"]);

type IssuerParts = { https: true; host: string; path: string } | { https: false };

/** An https issuer's host and path, parsed by hand: the contract compiles
 *  without DOM or Node types. */
function issuerPartsOf(issuer: string | null | undefined): IssuerParts {
  const value = issuer?.trim() ?? "";
  if (value.slice(0, 8).toLowerCase() !== "https://") return { https: false };
  const rest = value.slice(8);
  const ends = ["?", "#"].map((character) => rest.indexOf(character)).filter((at) => at !== -1);
  const address = ends.length === 0 ? rest : rest.slice(0, Math.min(...ends));
  const pathAt = address.indexOf("/");
  const host = pathAt === -1 ? address : address.slice(0, pathAt);
  if (host === "") return { https: false };
  return {
    https: true,
    host: host.toLowerCase(),
    path: pathAt === -1 ? "" : address.slice(pathAt),
  };
}

/** The issuer's parts when it is an Entra ID one. */
function entraPartsOf(issuer: string | null | undefined): IssuerParts {
  const parts = issuerPartsOf(issuer);
  return parts.https && ENTRA_CLOUDS.has(parts.host) ? parts : { https: false };
}

function segmentsOf(path: string): string[] {
  return path.split("/").filter((segment) => segment !== "");
}

/** Whether an OIDC issuer is Microsoft Entra ID. */
export function isEntraIssuer(issuer: string | null | undefined): boolean {
  return entraPartsOf(issuer).https;
}

/** The Microsoft Graph origins an Entra ID sign-in fetches userinfo from;
 *  empty for any other issuer. */
export function entraEndpointOrigins(issuer: string | null | undefined): readonly string[] {
  const parts = entraPartsOf(issuer);
  return (parts.https && ENTRA_CLOUDS.get(parts.host)) || [];
}

/** The issuer an Entra ID token carries, from the one typed: v2 `/<tenant>/v2.0`
 *  has no trailing slash, v1 `sts.windows.net/<tenant>/` exactly one. Tokens
 *  match the stored issuer exactly; others (Auth0 ends in a slash) are kept. */
export function canonicalEntraIssuer(issuer: string): string {
  const parts = entraPartsOf(issuer);
  if (!parts.https) return issuer;
  const origin = `https://${parts.host}`;
  const segments = segmentsOf(parts.path);
  if (segments.length === 2 && segments[1] === "v2.0") return `${origin}/${segments[0]}/v2.0`;
  if (parts.host === "sts.windows.net" && segments.length === 1) {
    return `${origin}/${segments[0]}/`;
  }
  return issuer;
}

export type EntraTenancy = { multiTenant: true; segment: string } | { multiTenant: false };

/** Whether an Entra ID issuer names a multi-tenant segment (`common`,
 *  `organizations`, `consumers`) instead of a tenant. */
export function entraTenancyOf(issuer: string): EntraTenancy {
  const parts = entraPartsOf(issuer);
  if (!parts.https) return { multiTenant: false };
  const first = segmentsOf(parts.path)[0]?.toLowerCase();
  return first && MULTI_TENANT_SEGMENTS.has(first)
    ? { multiTenant: true, segment: first }
    : { multiTenant: false };
}
