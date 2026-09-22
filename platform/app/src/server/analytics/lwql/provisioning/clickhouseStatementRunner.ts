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

const TOLERATED_CONFIG_STORE_CODES: ReadonlySet<number> = new Set(
  Object.values(CLICKHOUSE_CONFIG_STORE_ERROR_CODE),
);

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
 * A statement rejected because its target entity is defined in the read-only
 * config store (codes in {@link CLICKHOUSE_CONFIG_STORE_ERROR_CODE}: 495, 669,
 * 670, 671) is logged at WARN, collected into the returned `skipped` list, and
 * stepped over — the
 * app yields to the entity the server owns and keeps provisioning the rest.
 * Every other error still throws.
 */
export async function runClickHouseStatements({
  client,
  statements,
  secrets = [],
}: {
  client: ClickHouseClient;
  statements: string[];
  /** Values to strip from the logged error/statement — see {@link redactSecrets}. */
  secrets?: readonly (string | undefined)[];
}): Promise<RunClickHouseStatementsResult> {
  const skipped: SkippedProvisioningStatement[] = [];
  for (const [index, statement] of statements.entries()) {
    const position = `${index + 1}/${statements.length}`;
    try {
      await client.command({ query: statement });
    } catch (error) {
      const code = clickHouseErrorCode(error);
      if (code !== null && TOLERATED_CONFIG_STORE_CODES.has(code)) {
        const redactedStatement = redactSecrets(statement, secrets);
        skipped.push({ index: index + 1, code, statement: redactedStatement });
        logger.warn(
          { code, statement: position, skipped: redactedStatement },
          "lwql provisioning skipped a statement whose entity is defined in the ClickHouse config store (read-only) and continued",
        );
        continue;
      }
      logger.error(
        {
          error: redactSecrets(errorMessage(error), secrets),
          statement: position,
        },
        "lwql provisioning failed creating ClickHouse objects",
      );
      throw error;
    }
  }
  return { skipped };
}

/** An LWQL access entity found pre-defined in the ClickHouse config store. */
export interface ConfigStoreLwqlEntity {
  readonly kind: "user" | "settings_profile";
  readonly name: string;
}

/**
 * Reads `system.users` and `system.settings_profiles` for the LangWatchQL
 * identity and profile when they are defined in the read-only `users_xml`
 * store, logs any found once at WARN, and returns them — so the operator sees
 * by name what {@link runClickHouseStatements} is about to skip.
 *
 * Never throws: an inventory that cannot be read is logged and returns empty
 * rather than stopping a provisioning run that is otherwise fine.
 */
export async function inventoryConfigStoreLwqlEntities({
  client,
  names,
}: {
  client: ClickHouseClient;
  names: LangWatchQLNames;
}): Promise<ConfigStoreLwqlEntity[]> {
  // `restrictedUser` and `settingsProfile` are validated identifiers
  // (`assertNames`, `[A-Za-z0-9_]` only), so interpolating them as string
  // literals here cannot inject — a quote can never appear in the value.
  const query =
    `SELECT 'user' AS kind, name FROM system.users ` +
    `WHERE storage = 'users_xml' AND name = '${names.restrictedUser}'\n` +
    `UNION ALL\n` +
    `SELECT 'settings_profile' AS kind, name FROM system.settings_profiles ` +
    `WHERE storage = 'users_xml' AND name = '${names.settingsProfile}'`;
  try {
    const result = await client.query({ query, format: "JSONEachRow" });
    const rows = (await result.json()) as Array<{ kind: string; name: string }>;
    const entities = rows
      .filter(
        (row): row is ConfigStoreLwqlEntity =>
          row.kind === "user" || row.kind === "settings_profile",
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
      { error: errorMessage(error) },
      "lwql provisioning could not inventory the ClickHouse config store for pre-defined LangWatchQL entities — continuing",
    );
    return [];
  }
}
