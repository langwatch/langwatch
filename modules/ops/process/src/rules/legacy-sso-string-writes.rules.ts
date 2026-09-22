/** The legacy string columns' write rule, ADR-117 §5: once the connection
 *  projection decides sign-in, a `ssoDomain`/`ssoProvider` edit changes
 *  nothing a person would experience. */
export const LEGACY_SSO_STRING_COLUMNS = ["ssoDomain", "ssoProvider"] as const;

/**
 * The legacy columns a payload would write, in order, so a refusal can name
 * them. Empty means the edit touches none of them and is nobody's business
 * here.
 */
export function legacySsoStringColumnsIn(
  data: Record<string, unknown> | undefined | null,
): string[] {
  if (!data) return [];
  return LEGACY_SSO_STRING_COLUMNS.filter((column) => column in data);
}

/**
 * The columns an edit must be refused for, given whether THIS organization's
 * connection decides its sign-in — per organization, never fleet-wide. Where
 * the connection decides, accepting the edit would fool a staff member.
 */
export function legacySsoStringWritesToRefuse({
  data,
  connectionDecides,
}: {
  data: Record<string, unknown> | undefined | null;
  connectionDecides: boolean;
}): string[] {
  return connectionDecides ? legacySsoStringColumnsIn(data) : [];
}
