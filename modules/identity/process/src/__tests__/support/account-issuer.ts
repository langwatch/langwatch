import type { Account } from "better-auth";

/**
 * An account written through Better Auth with our `issuer` field, which its account type does
 * not carry (ADR-189). Typed as this, a value passes where Better Auth asks for an account.
 */
export type AccountWithIssuer = Omit<Account, "id" | "createdAt" | "updatedAt"> &
  Readonly<{ issuer: string }>;
