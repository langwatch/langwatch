import type { Account } from "better-auth";
import { z } from "zod";

/**
 * An account written through Better Auth with our `issuer` field, which its account type does
 * not carry (ADR-189). Typed as this, a value passes where Better Auth asks for an account.
 */
export type AccountWithIssuer<T = Omit<Account, "id" | "createdAt" | "updatedAt">> = T &
  Readonly<{ issuer: string }>;

/** The one claim read from a Microsoft ID token: its tenant's own issuer. */
const tenantIssuerClaimsSchema = z.looseObject({ iss: z.string().min(1) });
/** Our additional `issuer` field, which Better Auth's account type does not carry. */
const statedIssuerSchema = z.looseObject({ issuer: z.string().min(1) });

/**
 * The issuer namespace an account row carries (ADR-189): the connection's own issuer, else the
 * migration `20260825030000_account_issuer` backfill rule. Better Auth keys a row by
 * `(providerId, accountId)` since 1.7.3, so this column is LangWatch's to write.
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

/**
 * The issuer a new account row is stamped with, as Better Auth 1.7.1 wrote it: the one the row
 * already states, else the issuer a single sign-on assertion was verified under for this exact
 * subject, else a Microsoft ID token's tenant issuer, else the provider's stored namespace.
 */
export function accountIssuerOf({
  account,
  assertedIssuers,
  providerId,
  idToken,
}: {
  account: unknown;
  assertedIssuers: readonly string[];
  providerId: string;
  idToken: unknown;
}): string {
  const stated = statedIssuerSchema.safeParse(account);
  if (stated.success) return stated.data.issuer;
  const [assertedIssuer] = assertedIssuers;
  if (assertedIssuer) return assertedIssuer;
  const [tenantIssuer] = providerId === "microsoft" ? tenantIssuersOf({ idToken }) : [];
  return providerAccountIssuer({ connectionIssuer: tenantIssuer, provider: providerId });
}

/** The `iss` a Microsoft ID token states: one entry, or none for an unreadable token. */
function tenantIssuersOf({ idToken }: { idToken: unknown }): string[] {
  if (typeof idToken !== "string") return [];
  const payload = idToken.split(".")[1];
  if (!payload) return [];
  try {
    const parsed = tenantIssuerClaimsSchema.safeParse(
      JSON.parse(Buffer.from(payload, "base64url").toString("utf8")),
    );
    return parsed.success ? [parsed.data.iss] : [];
  } catch {
    return [];
  }
}
