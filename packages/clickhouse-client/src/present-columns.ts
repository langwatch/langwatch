/** The query a target's column list is read with; run it unscoped, it names no tenant data. */
export const CLICKHOUSE_COLUMNS_QUERY =
  "SELECT table, name FROM system.columns WHERE database = currentDatabase()";

/** How long a target's column list is trusted before the next select reads it again. */
export const CLICKHOUSE_COLUMNS_REFRESH_MS = 30_000;

type ColumnRow = Readonly<{ table: string; name: string }>;
type Tables = ReadonlyMap<string, ReadonlySet<string>>;

/**
 * One ClickHouse target's column list, cached and refreshed, so a read never names a column a
 * pending ClickHouse step has not added yet (NO-HOLDS, Alex 2026-10-09): `select` answers the
 * column, or its typed default under its name. Spec: specs/upgrade/in-app-upgrade.feature.
 */
export class ClickHouseColumns {
  static over({
    read,
    refreshMs = CLICKHOUSE_COLUMNS_REFRESH_MS,
    now = () => performance.now(),
  }: {
    read: () => Promise<readonly ColumnRow[]>;
    refreshMs?: number;
    now?: () => number;
  }): ClickHouseColumns {
    return new ClickHouseColumns(read, refreshMs, now);
  }

  private cached: Readonly<{ at: number; tables: Promise<Tables> }> | undefined;

  private constructor(
    private readonly read: () => Promise<readonly ColumnRow[]>,
    private readonly refreshMs: number,
    private readonly now: () => number,
  ) {}

  /**
   * A select list over `columns` (name to the SQL default it reads as while missing). An unknown
   * table or an unreadable list names every column: the query then fails as it would have.
   */
  async select({
    table,
    columns,
  }: {
    table: string;
    columns: Readonly<Record<string, string>>;
  }): Promise<string> {
    const present = (await this.tables().catch(() => undefined))?.get(table);
    return Object.entries(columns)
      .map(([name, missing]) =>
        present === undefined || present.has(name) ? name : `${missing} AS ${name}`,
      )
      .join(", ");
  }

  private tables(): Promise<Tables> {
    const at = this.now();
    if (this.cached && at - this.cached.at < this.refreshMs) return this.cached.tables;
    const tables = this.read().then(groupByTable);
    const entry = { at, tables };
    this.cached = entry;
    tables.catch(() => {
      if (this.cached === entry) this.cached = undefined;
    });
    return tables;
  }
}

function groupByTable(rows: readonly ColumnRow[]): Tables {
  const tables = new Map<string, Set<string>>();
  for (const { table, name } of rows) {
    const names = tables.get(table) ?? new Set<string>();
    names.add(name);
    tables.set(table, names);
  }
  return tables;
}
