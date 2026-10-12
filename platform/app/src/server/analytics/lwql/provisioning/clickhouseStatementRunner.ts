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
 * @see ./clickhouseErrors.ts — safe-to-log error classification
 * @see ./statementTarget.ts — statement target/kind parsing
 * @see ./selfProvisionEntry.ts — the only caller with I/O
 * @see specs/lwql/api.feature
 */

import type { ClickHouseClient } from "@clickhouse/client";
import { createLogger } from "@langwatch/observability";

import type { LangWatchQLNames } from "./accessModel";
import {
  CLICKHOUSE_CONFIG_STORE_ERROR_CODE,
  clickHouseErrorCode,
  clickHouseErrorSummary,
  NAMED_COLLECTION_CODES,
} from "./clickhouseErrors";
import {
  assertPlainIdentifier,
  statementKind,
  statementTarget,
} from "./statementTarget";

const logger = createLogger("langwatch:analytics:lwql:clickhouseRunner");

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
