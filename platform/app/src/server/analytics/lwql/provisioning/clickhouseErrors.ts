/**
 * Safe-to-log classification of ClickHouse / provisioning errors.
 *
 * Provisioning never logs statement text or a raw error message. Both can
 * carry the restricted user's password or the PostgreSQL reader password in
 * escaped form — `clickHouseLiteral` doubles `'` and backslashes, so a
 * password with either is not byte-identical to the value a redactor would
 * strip, and a value-based redaction cannot be relied on. This module turns a
 * thrown error into the safe-to-log shape instead: a numeric ClickHouse error
 * code and exception type, or for a non-ClickHouse error, only its primitive
 * system fields (`code`, `errno`, `syscall`) — never the message.
 *
 * @see ./clickhouseStatementRunner.ts — the config-store-tolerant runner that
 *   classifies failures with {@link CLICKHOUSE_CONFIG_STORE_ERROR_CODE}
 * @see specs/lwql/api.feature
 */

/**
 * ClickHouse error codes raised when a statement targets an LWQL entity the
 * server already owns in its read-only config store. Tolerated by
 * `runClickHouseStatements` (see `./clickhouseStatementRunner.ts`): the entity
 * belongs to another owner, so the app skips it and provisions the rest.
 */
export const CLICKHOUSE_CONFIG_STORE_ERROR_CODE = {
  /** The user/profile/row-policy/grant target lives in `users_xml`. */
  ACCESS_STORAGE_READONLY: 495,
  /**
   * A `DROP NAMED COLLECTION` of a config-XML-defined collection: the SQL store
   * has no `<name>.sql` to remove, so the server reports it as non-existent even
   * with `IF EXISTS`.
   */
  NAMED_COLLECTION_DOESNT_EXIST: 669,
  /** A `CREATE NAMED COLLECTION` whose name is already defined in a config XML. */
  NAMED_COLLECTION_ALREADY_EXISTS: 670,
  /** An `ALTER`/`DROP NAMED COLLECTION` of a config-XML-owned, immutable collection. */
  NAMED_COLLECTION_IS_IMMUTABLE: 671,
} as const;

/**
 * The named-collection codes are tolerated unconditionally: each is specific to
 * a `NAMED COLLECTION` statement whose collection is config-XML-defined, so the
 * failure itself proves the entity is config-owned. A 495 is not so specific —
 * it fires for any access entity in a read-only store — so it is tolerated only
 * against an inventoried entity (see `./clickhouseStatementRunner.ts`).
 */
export const NAMED_COLLECTION_CODES: ReadonlySet<number> = new Set([
  CLICKHOUSE_CONFIG_STORE_ERROR_CODE.NAMED_COLLECTION_DOESNT_EXIST,
  CLICKHOUSE_CONFIG_STORE_ERROR_CODE.NAMED_COLLECTION_ALREADY_EXISTS,
  CLICKHOUSE_CONFIG_STORE_ERROR_CODE.NAMED_COLLECTION_IS_IMMUTABLE,
]);

/**
 * The numeric ClickHouse error code carried by a thrown error, or `null`.
 *
 * `@clickhouse/client` throws a `ClickHouseError` whose `code` is the number as
 * a string; a raw HTTP error carries it only in the `Code: NNN.` message
 * prefix, read as a fallback.
 */
export function clickHouseErrorCode(error: unknown): number | null {
  const code = (error as { code?: unknown } | null)?.code;
  if (typeof code === "string" && /^\d+$/.test(code)) return Number(code);
  if (typeof code === "number") return code;
  const message = error instanceof Error ? error.message : String(error);
  const match = /Code:\s*(\d+)/.exec(message);
  return match ? Number(match[1]) : null;
}

/** The safe fields of a failed provisioning error — never its message. */
export interface ClickHouseErrorSummary {
  /** Numeric ClickHouse error code, or `null` for a non-ClickHouse error. */
  readonly code: number | null;
  /** The ClickHouse exception type name, else the error's constructor name. */
  readonly type: string;
  /** A non-ClickHouse system error's string code (e.g. `ECONNREFUSED`). */
  readonly systemCode?: string;
  /** A non-ClickHouse system error's numeric/string errno. */
  readonly errno?: string | number;
  /** A non-ClickHouse system error's syscall (e.g. `connect`). */
  readonly syscall?: string;
}

/**
 * The safe-to-log shape of a provisioning error: its numeric ClickHouse code and
 * exception type, and for a non-ClickHouse error (a connection failure, a Prisma
 * error) only the primitive system fields — never the message. A ClickHouse
 * error's message echoes the failing statement, which carries the password; a
 * connection error's message carries the `CLICKHOUSE_URL`/`DATABASE_URL` with
 * credentials. Both are omitted; only `code`, `errno` and `syscall`, which
 * cannot contain either, are surfaced.
 */
function errorTypeName(error: unknown): string {
  const type = (error as { type?: unknown } | null)?.type;
  if (typeof type === "string" && type.length > 0) return type;
  if (error instanceof Error) return error.constructor.name;
  return typeof error;
}

/**
 * The safe system primitives of a non-ClickHouse error — its string `.code`
 * (`ECONNREFUSED`, `P2010`), `errno` and `syscall` — none of which can carry SQL
 * or a connection URL. The message is deliberately never read.
 */
function systemErrorFields(error: unknown): {
  systemCode?: string;
  errno?: string | number;
  syscall?: string;
} {
  const err = error as {
    code?: unknown;
    errno?: unknown;
    syscall?: unknown;
  } | null;
  const fields: {
    systemCode?: string;
    errno?: string | number;
    syscall?: string;
  } = {};
  if (typeof err?.code === "string") fields.systemCode = err.code;
  if (typeof err?.errno === "number" || typeof err?.errno === "string") {
    fields.errno = err.errno;
  }
  if (typeof err?.syscall === "string") fields.syscall = err.syscall;
  return fields;
}

export function clickHouseErrorSummary(error: unknown): ClickHouseErrorSummary {
  const code = clickHouseErrorCode(error);
  return {
    code,
    type: errorTypeName(error),
    // A non-ClickHouse error carries no numeric ClickHouse code; surface only
    // its safe system primitives, never the message.
    ...(code === null ? systemErrorFields(error) : {}),
  };
}
