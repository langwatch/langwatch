import { SsoConnectionStringEditRetiredError } from "@langwatch/identity";

/**
 * The legacy string columns' write rule (ADR-117 §5).
 *
 * `Organization.ssoDomain` / `ssoProvider` are how enterprise SSO used to be
 * configured: two values a staff member set in the backoffice, with no
 * history, no guard and no way to ask why. The connection aggregate replaced
 * them, and the columns now answer only for organizations that never
 * registered a connection.
 *
 * WHICH IS THE RULE. An edit is refused exactly when it would change nothing
 * a person would experience — an organization whose connection decides its
 * sign-in — because that is a staff member believing they fixed something.
 * Everywhere else the strings still decide, so they stay editable.
 *
 * This used to be an environment variable with three modes, staged so a
 * fleet-wide flip could be rolled back in a hurry. There is no flip: routing
 * reads the projection first and falls back to the columns per organization,
 * so the answer differs per organization and a fleet-wide switch could only
 * ever be wrong for somebody. Asking the data is both simpler and correct.
 */
export const LEGACY_SSO_STRING_COLUMNS = ["ssoDomain", "ssoProvider"] as const;

/** The columns a payload would write. Exported so the refusal can name them
 *  and a test can assert on the naming rather than on prose. */
export function legacySsoStringColumnsIn(
  data: Record<string, unknown> | undefined | null,
): string[] {
  if (!data) return [];
  return LEGACY_SSO_STRING_COLUMNS.filter((column) => column in data);
}

/**
 * Refuse a legacy string edit for an organization whose connection decides
 * its sign-in. Called by the backoffice's organization update; every other
 * connection change already goes through the guarded commands.
 *
 * `hasConnection` is injected rather than read here so this module holds no
 * database. A create names no organization yet, so it can hold no connection
 * and the caller passes `null`.
 */
export async function assertLegacySsoStringWriteAllowed({
  organizationId,
  data,
  hasConnection,
}: {
  organizationId: string | null;
  data: Record<string, unknown> | undefined | null;
  hasConnection: (args: { organizationId: string }) => Promise<boolean>;
}): Promise<void> {
  const columns = legacySsoStringColumnsIn(data);
  if (columns.length === 0) return;
  if (organizationId === null) return;
  if (!(await hasConnection({ organizationId }))) return;
  throw new SsoConnectionStringEditRetiredError(
    `legacy sso columns are derived: ${columns.join(", ")}`,
  );
}
