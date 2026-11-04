/**
 * Who asserted an account's subject, stored on `Account.issuer`. Better Auth keys accounts by
 * `(providerId, accountId)` since 1.7.3 and no longer writes this, so the account hook does,
 * the way 1.7.0 did: the connection's issuer, else the `20260825030000_account_issuer` rule.
 */
export function providerAccountIssuer({
  connectionIssuer,
  provider,
  idTokenIssuer,
}: {
  connectionIssuer: string | undefined;
  provider: string;
  idTokenIssuer?: string | undefined;
}): string {
  if (connectionIssuer) return connectionIssuer;
  if (provider === "credential") return "local:credential";
  if (provider === "google") return "https://accounts.google.com";
  // Microsoft's issuer names the tenant, so only the verified token can say it.
  if (provider === "microsoft" && idTokenIssuer?.startsWith("https://")) return idTokenIssuer;
  return `local:oauth:${encodeURIComponent(provider)}`;
}

/** The issuer to store on an account row: the row's own, else the one its provider derives. */
export function getAccountIssuer({
  account,
  connectionIssuer,
}: {
  account: Readonly<{ providerId: string; idToken?: unknown; issuer?: unknown }>;
  connectionIssuer: string | undefined;
}): string {
  if (typeof account.issuer === "string" && account.issuer.length > 0) return account.issuer;
  const [idTokenIssuer] = findIdTokenIssuers(account.idToken);
  return providerAccountIssuer({ connectionIssuer, provider: account.providerId, idTokenIssuer });
}

/** The `iss` claim of an ID token Better Auth already verified: one entry, or none. */
export function findIdTokenIssuers(idToken: unknown): string[] {
  if (typeof idToken !== "string") return [];
  const payload = idToken.split(".")[1];
  if (!payload) return [];
  try {
    const base64 = payload.replace(/-/g, "+").replace(/_/g, "/");
    const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, "=");
    const bytes = Uint8Array.from(atob(padded), (char) => char.charCodeAt(0));
    const claims: unknown = JSON.parse(new TextDecoder().decode(bytes));
    if (typeof claims !== "object" || claims === null || !("iss" in claims)) return [];
    return typeof claims.iss === "string" && claims.iss.length > 0 ? [claims.iss] : [];
  } catch {
    return [];
  }
}
