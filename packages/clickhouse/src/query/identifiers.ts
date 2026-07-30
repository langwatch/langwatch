/**
 * Binds table and column names as `Identifier` parameters so no query ever
 * interpolates a name into its SQL.
 *
 * ```ts
 * const names = bindIdentifiers();
 * const sql =
 *   `SELECT ${names.list(table.columnNames)} FROM ${names.of(table.name)} ` +
 *   `WHERE ${names.of("TenantId")} = {tenantId:String}`;
 * await client.query({ tenantId, sql, params: { ...names.params, tenantId } });
 * ```
 */
export interface BoundIdentifiers {
  /** Binds one name and returns its placeholder. */
  of(name: string): string;
  /** Binds several names and returns them comma-joined, for a select list. */
  list(names: readonly string[]): string;
  /** The parameters the bound placeholders resolve against. */
  readonly params: Readonly<Record<string, string>>;
}

export function bindIdentifiers(): BoundIdentifiers {
  const params: Record<string, string> = {};
  const placeholders = new Map<string, string>();

  const of = (name: string): string => {
    const existing = placeholders.get(name);
    if (existing) return existing;
    const key = `id${placeholders.size}`;
    params[key] = name;
    const placeholder = `{${key}:Identifier}`;
    placeholders.set(name, placeholder);
    return placeholder;
  };

  return {
    of,
    list: (names) => names.map(of).join(", "),
    params,
  };
}
