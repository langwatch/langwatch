import { skipTenantCheck } from "@langwatch/prisma-client";
import type { PrismaClient } from "@langwatch/prisma-client/generated";

import { SEALED_VALUE_PATTERN } from "../../rules/credentials-reseal.rules.ts";
import {
  CredentialsResealRepository,
  type SealedCandidate,
  type SealedColumn,
  type SealedReplacement,
} from "../credentials-reseal.repository.ts";

/**
 * Exactly the raw operations the walk performs, picked from the real client so a
 * typed `PrismaClient` satisfies it with no cast. Table and column names come from
 * the database's own catalogue and are quoted; every value is bound.
 */
type CredentialsResealDatabase = Pick<PrismaClient, "$queryRawUnsafe" | "$transaction">;

// A cross-tenant credential re-seal: an operator task over every sealed column.
const TENANCY = skipTenantCheck({ SKIP_TENANT_CHECK: true }).sql;

type ColumnRow = {
  table: string;
  column: string;
  type: string;
  keyColumn: string | null;
  keyType: string | null;
};

const quoted = (identifier: string): string => `"${identifier.replaceAll('"', '""')}"`;

/** `ROW(k1, k2) <operator> ROW(CAST($n AS t1), ...)`, with the parameters numbered from `first`. */
function keyComparison({
  column,
  operator,
  first,
}: {
  column: SealedColumn;
  operator: "=" | ">";
  first: number;
}): string {
  const names = column.keys.map((key) => quoted(key.column)).join(", ");
  const values = column.keys
    .map((key, index) => `CAST($${first + index} AS ${quoted(key.type)})`)
    .join(", ");
  return `ROW(${names}) ${operator} ROW(${values})`;
}

export class PrismaCredentialsResealRepository extends CredentialsResealRepository {
  private constructor(private readonly database: CredentialsResealDatabase) {
    super();
  }

  static create(options: {
    database: CredentialsResealDatabase;
  }): PrismaCredentialsResealRepository {
    return new PrismaCredentialsResealRepository(options.database);
  }

  /**
   * Text and JSON columns of the connection's schema, from the system catalogue (the
   * information_schema views take minutes to join). A partition is skipped because
   * its parent covers its rows, a generated column because it cannot be written.
   */
  async findColumns(): Promise<SealedColumn[]> {
    const rows = await this.database.$queryRawUnsafe<ColumnRow[]>(`
      ${TENANCY}
      SELECT cl.relname AS "table", a.attname AS "column", t.typname AS "type",
             ka.attname AS "keyColumn", kt.typname AS "keyType"
      FROM pg_class cl
      JOIN pg_namespace n ON n.oid = cl.relnamespace AND n.nspname = current_schema()
      JOIN pg_attribute a
        ON a.attrelid = cl.oid AND a.attnum > 0 AND NOT a.attisdropped AND a.attgenerated = ''
      JOIN pg_type t
        ON t.oid = a.atttypid AND t.typname IN ('text', 'varchar', 'json', 'jsonb')
      LEFT JOIN pg_index i ON i.indrelid = cl.oid AND i.indisprimary
      LEFT JOIN LATERAL unnest(i.indkey::int2[]) WITH ORDINALITY AS k(attnum, position) ON true
      LEFT JOIN pg_attribute ka ON ka.attrelid = cl.oid AND ka.attnum = k.attnum
      LEFT JOIN pg_type kt ON kt.oid = ka.atttypid
      WHERE cl.relkind IN ('r', 'p')
        AND NOT cl.relispartition
        AND cl.relname <> '_prisma_migrations'
      ORDER BY cl.relname, a.attname, k.position
    `);

    const columns = new Map<string, SealedColumn & { keys: { column: string; type: string }[] }>();
    for (const row of rows) {
      const id = `${row.table}\u0000${row.column}`;
      const column = columns.get(id) ?? {
        table: row.table,
        column: row.column,
        type: row.type,
        keys: [],
      };
      if (row.keyColumn && row.keyType)
        column.keys.push({ column: row.keyColumn, type: row.keyType });
      columns.set(id, column);
    }
    return [...columns.values()];
  }

  async findCandidates({
    column,
    after,
    limit,
  }: {
    column: SealedColumn;
    after: readonly string[] | null;
    limit: number;
  }): Promise<SealedCandidate[]> {
    const value = quoted(column.column);
    const keys = column.keys.map((key) => quoted(key.column));
    const selected = keys.map((key, index) => `${key}::text AS "k${index}"`).join(", ");
    const rows = await this.database.$queryRawUnsafe<Record<string, string>[]>(
      `
      ${TENANCY}
      SELECT ${selected}, ${value}::text AS "value"
      FROM ${quoted(column.table)}
      WHERE ${value} IS NOT NULL AND ${value}::text ~ $1
        ${after ? `AND ${keyComparison({ column, operator: ">", first: 3 })}` : ""}
      ORDER BY ${keys.join(", ")}
      LIMIT CAST($2 AS int)
    `,
      SEALED_VALUE_PATTERN,
      limit,
      ...(after ?? []),
    );

    return rows.map((row) => ({
      key: column.keys.map((_key, index) => row[`k${index}`] ?? ""),
      value: row.value ?? "",
    }));
  }

  async replaceValues({
    column,
    rows,
  }: {
    column: SealedColumn;
    rows: readonly SealedReplacement[];
  }): Promise<number> {
    if (rows.length === 0) return 0;
    const value = quoted(column.column);
    const statement = `
      ${TENANCY}
      UPDATE ${quoted(column.table)}
      SET ${value} = CAST($1 AS ${quoted(column.type)})
      WHERE ${keyComparison({ column, operator: "=", first: 3 })} AND ${value}::text = $2
    `;

    return this.database.$transaction(
      async (transaction) => {
        let written = 0;
        for (const row of rows) {
          written += await transaction.$executeRawUnsafe(
            statement,
            row.value,
            row.expected,
            ...row.key,
          );
        }
        return written;
      },
      { timeout: 60_000 },
    );
  }
}
