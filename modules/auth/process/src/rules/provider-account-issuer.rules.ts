/**
 * The issuer Better Auth 1.7 keys an account by, as main writes it: the connection's
 * own issuer, else the migration `20260825030000_account_issuer` backfill rule.
 */
export function providerAccountIssuer({
  connectionIssuer,
  provider,
}: {
  connectionIssuer: string | undefined;
  provider: string;
}): string {
  if (connectionIssuer) return connectionIssuer;
  if (provider === "credential") return "local:credential";
  if (provider === "google") return "https://accounts.google.com";
  return `local:oauth:${encodeURIComponent(provider)}`;
}
