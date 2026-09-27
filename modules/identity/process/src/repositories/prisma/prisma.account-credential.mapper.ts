import { fromDate, type Instant, toDate } from "@langwatch/time";

import type { IdentityAccountSecrets } from "../../rules/identity-storage.rules.ts";

/** A secret as its column stores it: an expiry instant is a `DateTime` column. */
export function toColumnValue(value: string | Instant | null | undefined): string | Date | null {
  if (value === null || value === undefined || typeof value === "string") return value ?? null;
  return toDate(value);
}

/** A stored expiry as the identity branch holds it. */
export function toInstant(value: Date | null | undefined): Instant | null {
  return value ? fromDate(value) : null;
}

/** A secret patch as Prisma writes it, naming only the fields the patch names. */
export function toCredentialColumns(
  secrets: IdentityAccountSecrets,
): Record<string, string | Date | null> {
  return Object.fromEntries(
    Object.entries(secrets).map(([field, value]) => [field, toColumnValue(value)]),
  );
}
