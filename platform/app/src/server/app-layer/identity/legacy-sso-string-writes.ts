import { SsoConnectionStringEditRetiredError } from "@langwatch/identity";
import { env } from "~/env.mjs";

/**
 * The legacy string columns' write rule, in one place (ADR-117 §5).
 *
 * `Organization.ssoDomain` / `ssoProvider` are how enterprise SSO is
 * configured today: two values a staff member sets in the backoffice, with no
 * history, no guard and no way to ask why. D04 replaces them with an
 * aggregate, and the replacement is staged on `SSOCONN_ROUTING`:
 *
 *   off / shadow   the strings still DECIDE sign-in, so they must still be
 *                  editable. Nothing here refuses anything, and rollback is
 *                  the flag rather than a data restore.
 *   enforce        the connection projection decides. A string edit now
 *                  changes nothing a person would experience, which makes it
 *                  worse than useless — it is a staff member believing they
 *                  fixed something. Refused, pointing at the commands.
 *
 * Shipped at `off`, so this refuses nothing today. It ships WITH the flag
 * rather than at the flip because the flip has to be one value in one place:
 * a cutover that also needs a code change is a cutover nobody can roll back
 * in a hurry.
 */
export const LEGACY_SSO_STRING_COLUMNS = ["ssoDomain", "ssoProvider"] as const;

export function legacySsoStringWritesRetired(): boolean {
  return env.SSOCONN_ROUTING === "enforce";
}

/** The columns a payload would write. Exported so the refusal can name them
 *  and a test can assert on the naming rather than on prose. */
export function legacySsoStringColumnsIn(
  data: Record<string, unknown> | undefined | null,
): string[] {
  if (!data) return [];
  return LEGACY_SSO_STRING_COLUMNS.filter((column) => column in data);
}

/**
 * Refuse a legacy string edit once the connection projection decides routing.
 * Called by the backoffice's organization update; every other connection
 * change already goes through the guarded commands.
 */
export function assertLegacySsoStringWriteAllowed({
  data,
}: {
  data: Record<string, unknown> | undefined | null;
}): void {
  if (!legacySsoStringWritesRetired()) return;
  const columns = legacySsoStringColumnsIn(data);
  if (columns.length === 0) return;
  throw new SsoConnectionStringEditRetiredError(
    `legacy sso columns are derived: ${columns.join(", ")}`,
  );
}
