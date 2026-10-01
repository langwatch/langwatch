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

function hostOf(issuer: string | null | undefined): string | null {
  if (!issuer) return null;
  try {
    const url = new URL(issuer);
    return url.protocol === "https:" ? url.hostname.toLowerCase() : null;
  } catch {
    return null;
  }
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
