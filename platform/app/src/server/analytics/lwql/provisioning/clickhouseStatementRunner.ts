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
 * @see ../../../../tasks/provisionLwql.ts — the only caller with I/O
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

const STATEMENT_TARGET_PATTERNS: ReadonlyArray<{
  readonly kind: ConfigStoreLwqlEntity["kind"];
  readonly pattern: RegExp;
}> = [
  // A row policy names its short name right after the object keyword; `ON
  // <db.table>` follows. Checked first: its keyword is the most specific.
  {
    kind: "row_policy",
    pattern: new RegExp(
      `^\\s*(?:CREATE|ALTER|DROP)\\s+ROW\\s+POLICY\\s+${OPTIONAL_MODIFIERS}${IDENTIFIER}`,
      "i",
    ),
  },
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
 * its short name — or `null` for a statement that targets no config-store entity
 * (a table, view, named collection, function, or anything unrecognized).
 *
 * A 495 is excused only when this target matches an inventoried entity by BOTH
 * kind and name, so a row-policy statement whose `TO <user>` clause names the
 * config-owned user is NOT excused by that user: the target is the policy, not
 * the grantee. Keyword matching is case-insensitive and whole-token; names may
 * be backticked.
 */
function statementTarget(statement: string): ConfigStoreLwqlEntity | null {
  for (const { kind, pattern } of STATEMENT_TARGET_PATTERNS) {
    const match = pattern.exec(statement);
    if (match) return { kind, name: match[1] };
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

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Replaces every occurrence of each secret with a fixed marker.
 *
 * A ClickHouse error echoes the statement that failed, and the access-model
 * DDL embeds the restricted identity's password (`CREATE USER ... IDENTIFIED
 * WITH sha256_password BY '...'`) and the named collection's PostgreSQL reader
 * password; a connection error can surface the admin `CLICKHOUSE_URL` or
 * `DATABASE_URL`. Everything logged out of a provisioning failure goes through
 * here first. Literal `split`/`join` so no secret has to be escaped into a
 * regexp; empty and undefined secrets are skipped rather than matched.
 */
export function redactSecrets(
  text: string,
  secrets: readonly (string | undefined)[],
): string {
  let redacted = text;
  for (const secret of secrets) {
    if (secret) redacted = redacted.split(secret).join("[REDACTED]");
  }
  return redacted;
}

/** One statement skipped because its entity is owned by the config store. */
export interface SkippedProvisioningStatement {
  /** 1-based position in the statement list, as logged. */
  readonly index: number;
  /** The tolerated ClickHouse error code that caused the skip (495, 669, 670 or 671). */
  readonly code: number;
  /** The statement text, redacted of any supplied secrets. */
  readonly statement: string;
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
  secrets = [],
  configStoreEntities = [],
}: {
  client: ClickHouseClient;
  statements: string[];
  /** Values to strip from the logged error/statement — see {@link redactSecrets}. */
  secrets?: readonly (string | undefined)[];
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
        secrets,
        configStoreEntities,
      });
      const redactedStatement = redactSecrets(statement, secrets);
      skipped.push({ index: index + 1, code, statement: redactedStatement });
      logger.warn(
        { code, statement: position, skipped: redactedStatement },
        "lwql provisioning skipped a statement whose entity is defined in the ClickHouse config store (read-only) and continued",
      );
    }
  }
  return { skipped };
}

/**
 * Classifies a failed statement: returns the tolerated config-store code to skip
 * it under, or logs the failure at ERROR and rethrows. Keeps the abort/skip
 * decision — and its ERROR logging — out of {@link runClickHouseStatements}'s
 * loop.
 */
function toleratedConfigStoreSkipCode({
  error,
  statement,
  position,
  secrets,
  configStoreEntities,
}: {
  error: unknown;
  statement: string;
  position: string;
  secrets: readonly (string | undefined)[];
  configStoreEntities: readonly ConfigStoreLwqlEntity[];
}): number {
  const code = clickHouseErrorCode(error);
  if (code !== null && NAMED_COLLECTION_CODES.has(code)) return code;
  const isReadonly =
    code === CLICKHOUSE_CONFIG_STORE_ERROR_CODE.ACCESS_STORAGE_READONLY;
  // The statement's OWN target must be inventoried — matched by kind AND name.
  // Matching any inventoried name appearing anywhere would let a row policy's
  // `TO <config-owned user>` clause excuse a missing policy, booting without
  // tenant isolation.
  const target = isReadonly ? statementTarget(statement) : null;
  if (
    target &&
    configStoreEntities.some(
      (entity) => entity.kind === target.kind && entity.name === target.name,
    )
  ) {
    return code;
  }
  logger.error(
    { error: redactSecrets(errorMessage(error), secrets), statement: position },
    isReadonly
      ? "lwql provisioning: ClickHouse access storage is read-only for a statement whose own target entity is not in the config-store inventory — the access model would go unprovisioned (a config-owned user does not excuse a missing row policy), so provisioning is failing rather than booting with an incomplete model"
      : "lwql provisioning failed creating ClickHouse objects",
  );
  throw error;
}

/** An LWQL access entity found pre-defined in the ClickHouse config store. */
export interface ConfigStoreLwqlEntity {
  readonly kind: "user" | "settings_profile" | "row_policy";
  readonly name: string;
}

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
 * the LWQL policies target); their `short_name` is what the CREATE ROW POLICY
 * statements name, so that is the identity returned.
 *
 * A non-identifier name (a quote or any character outside `[A-Za-z0-9_]`)
 * throws before any query is issued, refusing to interpolate it. A query that
 * does run and fails is logged (redacted) and returns empty rather than
 * stopping a provisioning run that is otherwise fine.
 */
export async function inventoryConfigStoreLwqlEntities({
  client,
  names,
  secrets = [],
}: {
  client: ClickHouseClient;
  names: LangWatchQLNames;
  /** Values to strip from a logged inventory error — see {@link redactSecrets}. */
  secrets?: readonly (string | undefined)[];
}): Promise<ConfigStoreLwqlEntity[]> {
  // `productionLangWatchQLNames` does not validate its inputs, so these names
  // are validated here before interpolation: a quote in any of them is rejected
  // rather than closing the string literal it is spliced into.
  const restrictedUser = assertPlainIdentifier(names.restrictedUser);
  const settingsProfile = assertPlainIdentifier(names.settingsProfile);
  const query =
    `SELECT 'user' AS kind, name FROM system.users ` +
    `WHERE storage = 'users_xml' AND name = '${restrictedUser}'\n` +
    `UNION ALL\n` +
    `SELECT 'settings_profile' AS kind, name FROM system.settings_profiles ` +
    `WHERE storage = 'users_xml' AND name = '${settingsProfile}'\n` +
    `UNION ALL\n` +
    `SELECT 'row_policy' AS kind, short_name AS name FROM system.row_policies ` +
    `WHERE storage = 'users_xml' AND has(apply_to_list, '${restrictedUser}')`;
  try {
    const result = await client.query({ query, format: "JSONEachRow" });
    const rows = (await result.json()) as Array<{ kind: string; name: string }>;
    const entities = rows
      .filter((row): row is ConfigStoreLwqlEntity =>
        CONFIG_STORE_ENTITY_KINDS.has(row.kind),
      )
      .map((row) => ({ kind: row.kind, name: row.name }));
    if (entities.length > 0) {
      logger.warn(
        { entities },
        "lwql provisioning found LangWatchQL access entities defined in the ClickHouse config store (users.xml) — read-only to SQL, so they are skipped and provisioning continues with the rest",
      );
    }
    return entities;
  } catch (error) {
    logger.warn(
      { error: redactSecrets(errorMessage(error), secrets) },
      "lwql provisioning could not inventory the ClickHouse config store for pre-defined LangWatchQL entities — continuing",
    );
    return [];
  }
}
