/**
 * Runs a list of ClickHouse provisioning statements one at a time, tolerating
 * the errors a statement raises when its target entity is already defined in
 * the server's own config store (users.xml / config.xml) and is therefore
 * read-only to SQL.
 *
 * The application owns the LangWatchQL access model on every distribution and
 * converges it on every boot (issue #8258). Where an operator has instead baked
 * an LWQL entity into ClickHouse's config files, that entity cannot be created
 * or altered through SQL: `CREATE USER OR REPLACE`, `GRANT ... TO` it, and
 * `CREATE`/`DROP NAMED COLLECTION` all fail. The right behaviour is to yield to
 * the config-defined entity — log it, skip it, and provision everything else
 * (views, engine tables, key map) so the deployment still works — never to
 * crash the boot. This runner is that tolerance, kept out of the task module so
 * a test can exercise it without pulling the task's Prisma/db graph.
 *
 * Provisioning never logs statement text or a raw error message. Both can carry
 * the restricted user's password or the PostgreSQL reader password in escaped
 * form — `clickHouseLiteral` doubles `'` and backslashes, so a password with
 * either is not byte-identical to the value a redactor would strip, and a value-
 * based redaction cannot be relied on. Every failure is logged by statement kind
 * ({@link statementKind}), 1-based position, and a {@link clickHouseErrorSummary}
 * (numeric code and exception type, never the message) instead.
 *
 * @see ./selfProvisionEntry.ts — the only caller with I/O
 * @see specs/lwql/api.feature
 */

import type { ClickHouseClient } from "@clickhouse/client";
import { createLogger } from "@langwatch/observability";

import type { LangWatchQLNames } from "./accessModel";

const logger = createLogger("langwatch:analytics:lwql:clickhouseRunner");

/**
 * ClickHouse error codes raised when a statement targets an LWQL entity the
 * server already owns in its read-only config store. Tolerated by
 * {@link runClickHouseStatements}: the entity belongs to another owner, so the
 * app skips it and provisions the rest.
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
 * against an inventoried entity (see {@link runClickHouseStatements}).
 */
const NAMED_COLLECTION_CODES: ReadonlySet<number> = new Set([
  CLICKHOUSE_CONFIG_STORE_ERROR_CODE.NAMED_COLLECTION_DOESNT_EXIST,
  CLICKHOUSE_CONFIG_STORE_ERROR_CODE.NAMED_COLLECTION_ALREADY_EXISTS,
  CLICKHOUSE_CONFIG_STORE_ERROR_CODE.NAMED_COLLECTION_IS_IMMUTABLE,
]);

// Whole-token identifier, optionally backticked, capturing the bare name.
const IDENTIFIER = "`?([A-Za-z0-9_]+)`?";
// Optional `OR REPLACE` / `IF [NOT] EXISTS` between the object keyword and name.
const OPTIONAL_MODIFIERS =
  "(?:OR\\s+REPLACE\\s+)?(?:IF\\s+(?:NOT\\s+)?EXISTS\\s+)?";

// A row policy is keyed by short name AND its `ON <db>.<table>` target, so the
// pattern captures all three: 1 = short name, 2 = database (optional), 3 =
// table. Two tables can carry the same bare short name, so the ON target is
// load-bearing, not decoration — see {@link toleratedConfigStoreSkipCode}.
const ROW_POLICY_PATTERN = new RegExp(
  `^\\s*(?:CREATE|ALTER|DROP)\\s+ROW\\s+POLICY\\s+${OPTIONAL_MODIFIERS}${IDENTIFIER}\\s+ON\\s+(?:${IDENTIFIER}\\.)?${IDENTIFIER}`,
  "i",
);

const STATEMENT_TARGET_PATTERNS: ReadonlyArray<{
  readonly kind: "user" | "settings_profile";
  readonly pattern: RegExp;
}> = [
  {
    kind: "settings_profile",
    pattern: new RegExp(
      `^\\s*(?:CREATE|ALTER|DROP)\\s+SETTINGS\\s+PROFILE\\s+${OPTIONAL_MODIFIERS}${IDENTIFIER}`,
      "i",
    ),
  },
  {
    // `CREATE USER ... SETTINGS PROFILE <p>` still targets the user: the profile
    // is a clause, and this pattern anchors on `USER`, not on `SETTINGS`.
    kind: "user",
    pattern: new RegExp(
      `^\\s*(?:CREATE|ALTER|DROP)\\s+USER\\s+${OPTIONAL_MODIFIERS}${IDENTIFIER}`,
      "i",
    ),
  },
  // A grant/revoke targets the grantee — the user named after TO/FROM.
  {
    kind: "user",
    pattern: new RegExp(`^\\s*GRANT\\b[\\s\\S]*?\\bTO\\s+${IDENTIFIER}`, "i"),
  },
  {
    kind: "user",
    pattern: new RegExp(
      `^\\s*REVOKE\\b[\\s\\S]*?\\bFROM\\s+${IDENTIFIER}`,
      "i",
    ),
  },
];

/**
 * The access entity a statement targets in its OWN right — the user it
 * creates/alters/drops or grants to, the settings profile, or the row policy by
 * its short name AND its `ON <db>.<table>` target — or `null` for a statement
 * that targets no config-store entity (a table, view, named collection,
 * function, or anything unrecognized).
 *
 * A 495 is excused only when this target matches an inventoried entity (see
 * {@link toleratedConfigStoreSkipCode}). A row-policy statement whose `TO <user>`
 * clause names the config-owned user is NOT excused by that user — the target is
 * the policy, not the grantee — and a policy short name is qualified by its ON
 * target, so the same short name on another table is a different policy. Keyword
 * matching is case-insensitive and whole-token; names may be backticked.
 */
function statementTarget(statement: string): ConfigStoreLwqlEntity | null {
  const policy = ROW_POLICY_PATTERN.exec(statement);
  if (policy) {
    // `noUncheckedIndexedAccess`: narrow the required groups. The short name and
    // table are mandatory in the pattern, so a match always has them; database
    // is the optional `(?:<db>\.)?` group and may be undefined.
    const [, name, database, table] = policy;
    if (name !== undefined && table !== undefined) {
      return { kind: "row_policy", name, database, table };
    }
  }
  for (const { kind, pattern } of STATEMENT_TARGET_PATTERNS) {
    const name = pattern.exec(statement)?.[1];
    if (name !== undefined) return { kind, name };
  }
  return null;
}

/** Throws unless `name` is a bare identifier safe to interpolate into a query. */
function assertPlainIdentifier(name: string): string {
  if (!/^[A-Za-z0-9_]+$/.test(name)) {
    throw new Error(
      `lwql provisioning: refusing to interpolate a non-identifier name into the config-store inventory query: ${JSON.stringify(name)}`,
    );
  }
  return name;
}

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

// Leading object keywords that qualify a DDL verb, so `CREATE USER lwql` logs as
// `CREATE USER` — never the identifier. Consumed until the first non-keyword.
const STATEMENT_OBJECT_KEYWORDS: ReadonlySet<string> = new Set([
  "USER",
  "ROLE",
  "ROW",
  "POLICY",
  "SETTINGS",
  "PROFILE",
  "NAMED",
  "COLLECTION",
  "FUNCTION",
  "TABLE",
  "VIEW",
  "MATERIALIZED",
  "LIVE",
  "DICTIONARY",
  "DATABASE",
  "QUOTA",
  "INTO",
]);

/**
 * The leading DDL keywords of a statement — `CREATE USER`, `CREATE ROW POLICY`,
 * `CREATE NAMED COLLECTION`, `GRANT`, `DROP NAMED COLLECTION` — with no
 * identifier, quote or value, so it is always safe to log. The `OR REPLACE` and
 * `IF [NOT] EXISTS` modifiers are dropped as noise; `GRANT`/`REVOKE` reduce to
 * the verb alone. Returns `UNKNOWN` for a statement with no leading keyword.
 */
export function statementKind(statement: string): string {
  const tokens = statement
    .replace(/\bOR\s+REPLACE\b/gi, " ")
    .replace(/\bIF\s+(?:NOT\s+)?EXISTS\b/gi, " ")
    .trim()
    .split(/\s+/);
  const verb = tokens[0]?.toUpperCase();
  if (verb === undefined || !/^[A-Z]+$/.test(verb)) return "UNKNOWN";
  if (verb === "GRANT" || verb === "REVOKE") return verb;
  const objects: string[] = [];
  for (const token of tokens.slice(1)) {
    const upper = token.toUpperCase();
    if (objects.length >= 3 || !STATEMENT_OBJECT_KEYWORDS.has(upper)) break;
    objects.push(upper);
  }
  return [verb, ...objects].join(" ");
}

/** One statement skipped because its entity is owned by the config store. */
export interface SkippedProvisioningStatement {
  /** 1-based position in the statement list, as logged. */
  readonly index: number;
  /** The tolerated ClickHouse error code that caused the skip (495, 669, 670 or 671). */
  readonly code: number;
  /** The statement kind ({@link statementKind}) — never the statement text. */
  readonly kind: string;
}

export interface RunClickHouseStatementsResult {
  /** The config-store-owned statements that were logged and skipped. */
  readonly skipped: SkippedProvisioningStatement[];
}

/**
 * One statement per round trip rather than a single batched command: a failure
 * here is an operator's problem to fix, and ClickHouse reports only that *the*
 * command failed. Sending them individually is what lets the log name which
 * one, which is the difference between an actionable error and "provisioning
 * failed".
 *
 * A `NAMED COLLECTION` statement rejected with 669/670/671 is always tolerated
 * (the code itself proves the collection is config-XML-owned). A 495
 * ACCESS_STORAGE_READONLY is tolerated only when the failing statement's OWN
 * target entity — the user it creates or grants to, its settings profile, or a
 * row policy by short name (see {@link statementTarget}) — is in
 * `configStoreEntities` by matching kind AND name. Matching a config-owned user
 * named merely in a policy's `TO` clause is deliberately not enough: that would
 * let a missing row policy be skipped and boot continue without tenant
 * isolation. A 495 whose own target is not inventoried means the model would
 * silently go unprovisioned; that goes through the error+throw path. A tolerated
 * statement is logged at WARN, collected into `skipped`, and stepped over.
 * Every other error still throws.
 */
export async function runClickHouseStatements({
  client,
  statements,
  configStoreEntities = [],
}: {
  client: ClickHouseClient;
  statements: string[];
  /**
   * The config-store entities {@link inventoryConfigStoreLwqlEntities} found.
   * A 495 is tolerated only against a statement that names one of these.
   */
  configStoreEntities?: readonly ConfigStoreLwqlEntity[];
}): Promise<RunClickHouseStatementsResult> {
  const skipped: SkippedProvisioningStatement[] = [];
  for (const [index, statement] of statements.entries()) {
    const position = `${index + 1}/${statements.length}`;
    try {
      await client.command({ query: statement });
    } catch (error) {
      // Throws for every non-tolerable failure (logging it first); otherwise
      // returns the tolerated code to skip.
      const code = toleratedConfigStoreSkipCode({
        error,
        statement,
        position,
        configStoreEntities,
      });
      const kind = statementKind(statement);
      skipped.push({ index: index + 1, code, kind });
      logger.warn(
        { code, statement: position, kind },
        "lwql provisioning skipped a statement whose entity is defined in the ClickHouse config store (read-only) and continued",
      );
    }
  }
  return { skipped };
}

/**
 * Whether an inventoried `entity` is the statement's own `target`. Users and
 * settings profiles match on kind + name. A row policy also matches on its `ON`
 * table, and on the database only when the statement qualifies it AND the
 * inventoried entity has one (both compared exactly) — so `x_tenant ON db.a`
 * never excuses `x_tenant ON db.b`, but an unqualified inventory row still
 * matches a qualified statement on the same table.
 */
function entityMatchesTarget(
  entity: ConfigStoreLwqlEntity,
  target: ConfigStoreLwqlEntity,
): boolean {
  if (entity.kind !== target.kind || entity.name !== target.name) return false;
  if (entity.kind === "row_policy" && target.kind === "row_policy") {
    if (entity.table !== target.table) return false;
    if (
      entity.database !== undefined &&
      target.database !== undefined &&
      entity.database !== target.database
    ) {
      return false;
    }
  }
  return true;
}

/**
 * Classifies a failed statement: returns the tolerated config-store code to skip
 * it under, or logs the failure at ERROR and rethrows. Keeps the abort/skip
 * decision — and its ERROR logging — out of {@link runClickHouseStatements}'s
 * loop. A 495 is tolerated only when the statement's own target — matched by
 * short name and, for a row policy, its ON target — is in the inventory.
 */
function toleratedConfigStoreSkipCode({
  error,
  statement,
  position,
  configStoreEntities,
}: {
  error: unknown;
  statement: string;
  position: string;
  configStoreEntities: readonly ConfigStoreLwqlEntity[];
}): number {
  const code = clickHouseErrorCode(error);
  if (code !== null && NAMED_COLLECTION_CODES.has(code)) return code;
  const isReadonly =
    code === CLICKHOUSE_CONFIG_STORE_ERROR_CODE.ACCESS_STORAGE_READONLY;
  // The statement's OWN target must be inventoried — matched by kind, name and,
  // for a row policy, its ON target (see {@link entityMatchesTarget}). Matching
  // by name alone would let a row policy's `TO <config-owned user>` clause excuse
  // a missing policy, or an inventoried `x_tenant ON db.a` excuse a read-only
  // `x_tenant ON db.b` — booting a table with no tenant isolation.
  const target = isReadonly ? statementTarget(statement) : null;
  if (
    target &&
    configStoreEntities.some((entity) => entityMatchesTarget(entity, target))
  ) {
    return CLICKHOUSE_CONFIG_STORE_ERROR_CODE.ACCESS_STORAGE_READONLY;
  }
  logger.error(
    {
      error: clickHouseErrorSummary(error),
      statement: position,
      kind: statementKind(statement),
    },
    isReadonly
      ? "lwql provisioning: ClickHouse access storage is read-only for a statement whose own target entity is not in the config-store inventory — the access model would go unprovisioned (a config-owned user does not excuse a missing row policy), so provisioning is failing rather than booting with an incomplete model"
      : "lwql provisioning failed creating ClickHouse objects",
  );
  throw error;
}

/**
 * An LWQL access entity found pre-defined in the ClickHouse config store, or the
 * target of a statement being classified. A row policy is keyed by its short
 * name AND its `ON <db>.<table>` target — two tables can share a bare short name
 * — so that variant carries `table` (and `database` when the source qualifies
 * it); a user or settings profile is keyed by name alone.
 */
export type ConfigStoreLwqlEntity =
  | { readonly kind: "user"; readonly name: string }
  | { readonly kind: "settings_profile"; readonly name: string }
  | {
      readonly kind: "row_policy";
      readonly name: string;
      /** The table the policy is on. */
      readonly table: string;
      /** The database qualifying `table`; undefined when the source omits it. */
      readonly database?: string;
    };

const CONFIG_STORE_ENTITY_KINDS: ReadonlySet<string> = new Set([
  "user",
  "settings_profile",
  "row_policy",
]);

/**
 * Reads `system.users`, `system.settings_profiles` and `system.row_policies`
 * for the LangWatchQL identity, profile and row policies when they are defined
 * in the read-only `users_xml` store, logs any found once at WARN, and returns
 * them — so the operator sees by name what {@link runClickHouseStatements} is
 * about to skip, and so a 495 is tolerated only against one of these names.
 *
 * Row policies are matched by the restricted user they apply to (the only user
 * the LWQL policies target); each is returned by `short_name` AND its
 * `database`/`table` — a policy is keyed by short name plus ON target, so the
 * same short name on another table is a different policy.
 *
 * A non-identifier name (a quote or any character outside `[A-Za-z0-9_]`)
 * throws before any query is issued, refusing to interpolate it. A query that
 * does run and fails is logged as an error summary (code and type, never the
 * message) and returns empty rather than stopping a provisioning run that is
 * otherwise fine.
 */
export async function inventoryConfigStoreLwqlEntities({
  client,
  names,
}: {
  client: ClickHouseClient;
  names: LangWatchQLNames;
}): Promise<ConfigStoreLwqlEntity[]> {
  // `productionLangWatchQLNames` does not validate its inputs, so these names
  // are validated here before interpolation: a quote in any of them is rejected
  // rather than closing the string literal it is spliced into.
  const restrictedUser = assertPlainIdentifier(names.restrictedUser);
  const settingsProfile = assertPlainIdentifier(names.settingsProfile);
  // `database`/`table` are meaningful only for a row policy (keyed by short name
  // + ON target); the user/profile rows carry empty strings so the UNION ALL
  // keeps one column shape.
  const query =
    `SELECT 'user' AS kind, name, '' AS database, '' AS table FROM system.users ` +
    `WHERE storage = 'users_xml' AND name = '${restrictedUser}'\n` +
    `UNION ALL\n` +
    `SELECT 'settings_profile' AS kind, name, '' AS database, '' AS table FROM system.settings_profiles ` +
    `WHERE storage = 'users_xml' AND name = '${settingsProfile}'\n` +
    `UNION ALL\n` +
    `SELECT 'row_policy' AS kind, short_name AS name, database, table FROM system.row_policies ` +
    `WHERE storage = 'users_xml' AND has(apply_to_list, '${restrictedUser}')`;
  try {
    const result = await client.query({ query, format: "JSONEachRow" });
    const rows = (await result.json()) as Array<{
      kind: string;
      name: string;
      database: string;
      table: string;
    }>;
    const entities = rows
      .filter((row) => CONFIG_STORE_ENTITY_KINDS.has(row.kind))
      .map(
        (row): ConfigStoreLwqlEntity =>
          row.kind === "row_policy"
            ? {
                kind: "row_policy",
                name: row.name,
                table: row.table,
                database: row.database,
              }
            : {
                kind: row.kind as "user" | "settings_profile",
                name: row.name,
              },
      );
    if (entities.length > 0) {
      logger.warn(
        { entities },
        "lwql provisioning found LangWatchQL access entities defined in the ClickHouse config store (users.xml) — read-only to SQL, so they are skipped and provisioning continues with the rest",
      );
    }
    return entities;
  } catch (error) {
    logger.warn(
      { error: clickHouseErrorSummary(error) },
      "lwql provisioning could not inventory the ClickHouse config store for pre-defined LangWatchQL entities — continuing",
    );
    return [];
  }
}
