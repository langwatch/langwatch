/**
 * What a ClickHouse config store (users.xml / users.d) owning part of the LangWatchQL access
 * model means for provisioning: which failures are tolerated and who owns the model (ADR-159).
 * @see specs/lwql/access-model.feature
 */

/** Verified on clickhouse-server 25.10.2. */
export const CLICKHOUSE_CONFIG_STORE_ERROR_CODE = {
  /** A SQL statement targeted an entity whose storage is the read-only users.xml. */
  ACCESS_STORAGE_READONLY: 495,
  NAMED_COLLECTION_DOESNT_EXIST: 669,
  NAMED_COLLECTION_ALREADY_EXISTS: 670,
  NAMED_COLLECTION_IS_IMMUTABLE: 671,
} as const;

const NAMED_COLLECTION_CODES: ReadonlySet<number> = new Set([
  CLICKHOUSE_CONFIG_STORE_ERROR_CODE.NAMED_COLLECTION_DOESNT_EXIST,
  CLICKHOUSE_CONFIG_STORE_ERROR_CODE.NAMED_COLLECTION_ALREADY_EXISTS,
  CLICKHOUSE_CONFIG_STORE_ERROR_CODE.NAMED_COLLECTION_IS_IMMUTABLE,
]);

export type ConfigStoreLwqlEntity =
  | { readonly kind: "user"; readonly name: string }
  | { readonly kind: "settings_profile"; readonly name: string }
  | {
      readonly kind: "row_policy";
      readonly name: string;
      readonly table: string;
      /** Absent when the statement named the table unqualified. */
      readonly database?: string;
    };

/** Who owns the restricted identity right now. */
export type LwqlAccessModelOwner = "config_store" | "sql_store" | "none";

export interface ClickHouseErrorSummary {
  /** The ClickHouse error code, when the failure came from the server. */
  readonly code: number | null;
  readonly type: string;
  readonly systemCode?: string;
  readonly errno?: string | number;
  readonly syscall?: string;
}

const IDENTIFIER = "`?([A-Za-z0-9_]+)`?";
const OPTIONAL_MODIFIERS = "(?:OR\\s+REPLACE\\s+)?(?:IF\\s+(?:NOT\\s+)?EXISTS\\s+)?";

const ROW_POLICY_PATTERN = new RegExp(
  `^\\s*(?:CREATE|ALTER|DROP)\\s+ROW\\s+POLICY\\s+${OPTIONAL_MODIFIERS}${IDENTIFIER}\\s+ON\\s+(?:${IDENTIFIER}\\.)?${IDENTIFIER}`,
  "i",
);

const STATEMENT_TARGET_PATTERNS: readonly {
  readonly kind: "user" | "settings_profile";
  readonly pattern: RegExp;
}[] = [
  {
    kind: "settings_profile",
    pattern: new RegExp(
      `^\\s*(?:CREATE|ALTER|DROP)\\s+SETTINGS\\s+PROFILE\\s+${OPTIONAL_MODIFIERS}${IDENTIFIER}`,
      "i",
    ),
  },
  {
    kind: "user",
    pattern: new RegExp(
      `^\\s*(?:CREATE|ALTER|DROP)\\s+USER\\s+${OPTIONAL_MODIFIERS}${IDENTIFIER}`,
      "i",
    ),
  },
  { kind: "user", pattern: new RegExp(`^\\s*GRANT\\b[\\s\\S]*?\\bTO\\s+${IDENTIFIER}`, "i") },
  { kind: "user", pattern: new RegExp(`^\\s*REVOKE\\b[\\s\\S]*?\\bFROM\\s+${IDENTIFIER}`, "i") },
];

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

const CONFIG_STORE_ENTITY_KINDS: ReadonlySet<string> = new Set([
  "user",
  "settings_profile",
  "row_policy",
]);

/** The entity a statement acts on, when it is one the config store can own. */
function statementTargets(statement: string): ConfigStoreLwqlEntity[] {
  const policy = ROW_POLICY_PATTERN.exec(statement);
  if (policy) {
    const [, name, database, table] = policy;
    if (name !== undefined && table !== undefined) {
      return [
        database
          ? { kind: "row_policy", name, database, table }
          : { kind: "row_policy", name, table },
      ];
    }
  }
  for (const { kind, pattern } of STATEMENT_TARGET_PATTERNS) {
    const name = pattern.exec(statement)?.[1];
    if (name !== undefined) return [{ kind, name }];
  }
  return [];
}

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

function assertPlainIdentifier(name: string): string {
  if (!/^[A-Za-z0-9_]+$/.test(name)) {
    throw new Error(
      `lwql provisioning: refusing to interpolate a non-identifier name into the config-store inventory query: ${JSON.stringify(name)}`,
    );
  }
  return name;
}

/** Where a failure came from: a ClickHouse server code, or anything else (network, client). */
export type ClickHouseFailureOrigin = { from: "server"; code: number } | { from: "client" };

export function readClickHouseFailure(error: unknown): ClickHouseFailureOrigin {
  const code = (error as { code?: unknown } | null)?.code;
  if (typeof code === "string" && /^\d+$/.test(code)) return { from: "server", code: Number(code) };
  if (typeof code === "number") return { from: "server", code };
  const message = error instanceof Error ? error.message : String(error);
  const match = /Code:\s*(\d+)/.exec(message);
  return match ? { from: "server", code: Number(match[1]) } : { from: "client" };
}

function errorTypeName(error: unknown): string {
  const type = (error as { type?: unknown } | null)?.type;
  if (typeof type === "string" && type.length > 0) return type;
  if (error instanceof Error) return error.constructor.name;
  return typeof error;
}

/** A loggable summary that never carries the message, which can echo DDL with a password. */
export function clickHouseErrorSummary(error: unknown): ClickHouseErrorSummary {
  const failure = readClickHouseFailure(error);
  const typeName = errorTypeName(error);
  if (failure.from === "server") return { code: failure.code, type: typeName };
  const code = null;
  const err = error as { code?: unknown; errno?: unknown; syscall?: unknown } | null;
  return {
    code,
    type: typeName,
    ...(typeof err?.code === "string" ? { systemCode: err.code } : {}),
    ...(typeof err?.errno === "number" || typeof err?.errno === "string"
      ? { errno: err.errno }
      : {}),
    ...(typeof err?.syscall === "string" ? { syscall: err.syscall } : {}),
  };
}

/** A statement's verb and object keywords (`CREATE ROW POLICY`), never its names or values. */
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

export type ConfigStoreTolerance = { tolerated: true; code: number } | { tolerated: false };

/**
 * 669/670/671 are tolerated for the named collection, and 495 only when the statement's own
 * target is an inventoried config-store entity. Anything else is fatal.
 */
export function decideConfigStoreTolerance({
  error,
  statement,
  configStoreEntities,
}: {
  error: unknown;
  statement: string;
  configStoreEntities: readonly ConfigStoreLwqlEntity[];
}): ConfigStoreTolerance {
  const failure = readClickHouseFailure(error);
  if (failure.from === "client") return { tolerated: false };
  if (NAMED_COLLECTION_CODES.has(failure.code)) return { tolerated: true, code: failure.code };
  if (failure.code !== CLICKHOUSE_CONFIG_STORE_ERROR_CODE.ACCESS_STORAGE_READONLY) {
    return { tolerated: false };
  }
  const owned = statementTargets(statement).some((target) =>
    configStoreEntities.some((entity) => entityMatchesTarget(entity, target)),
  );
  return owned ? { tolerated: true, code: failure.code } : { tolerated: false };
}

/** The two names the inventory and the owner probe look up. */
export interface LwqlAccessModelIdentity {
  readonly restrictedUser: string;
  readonly settingsProfile: string;
}

/** The users.xml-owned LangWatchQL entities, read from the three system tables. */
export function configStoreInventoryQuery(names: LwqlAccessModelIdentity): string {
  const restrictedUser = assertPlainIdentifier(names.restrictedUser);
  const settingsProfile = assertPlainIdentifier(names.settingsProfile);
  return (
    `SELECT 'user' AS kind, name, '' AS database, '' AS table FROM system.users ` +
    `WHERE storage = 'users_xml' AND name = '${restrictedUser}'\n` +
    `UNION ALL\n` +
    `SELECT 'settings_profile' AS kind, name, '' AS database, '' AS table FROM system.settings_profiles ` +
    `WHERE storage = 'users_xml' AND name = '${settingsProfile}'\n` +
    `UNION ALL\n` +
    `SELECT 'row_policy' AS kind, short_name AS name, database, table FROM system.row_policies ` +
    `WHERE storage = 'users_xml' AND has(apply_to_list, '${restrictedUser}')`
  );
}

export function configStoreEntitiesFromRows(
  rows: readonly { kind: string; name: string; database: string; table: string }[],
): ConfigStoreLwqlEntity[] {
  return rows.flatMap((row): ConfigStoreLwqlEntity[] => {
    if (!CONFIG_STORE_ENTITY_KINDS.has(row.kind)) return [];
    if (row.kind === "row_policy") {
      return [{ kind: "row_policy", name: row.name, table: row.table, database: row.database }];
    }
    return [{ kind: row.kind === "user" ? "user" : "settings_profile", name: row.name }];
  });
}

/** Config store wins; otherwise a SQL-store user means the app's model is in place. */
export function classifyLwqlAccessModelOwner({
  configStoreEntityCount,
  sqlStoreUserCount,
}: {
  configStoreEntityCount: number;
  sqlStoreUserCount: number;
}): LwqlAccessModelOwner {
  if (configStoreEntityCount > 0) return "config_store";
  if (sqlStoreUserCount > 0) return "sql_store";
  return "none";
}
