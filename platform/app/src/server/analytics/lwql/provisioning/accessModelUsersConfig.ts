/**
 * LangWatchQL access model — the `users.d` / `config.d` YAML emitter.
 *
 * The chart-managed `clickhouse-serverless` pods and SaaS mount the LWQL access
 * model as per-pod config rather than provisioning it with DDL, so it lands on
 * every replica (issue #8258, AC3). This module renders the two files the chart
 * contract names, from the same {@link ./accessModelDefinition.ts} the SQL DDL
 * emitter reads — a parity test proves the two name the identical model (AC6).
 *
 * Two files, matching the fixed app↔chart contract:
 *  - `users.d/lwql-access.yaml` — the restricted user (`password_sha256_hex`
 *    only, never the plaintext — AC5), its settings profile with constraints,
 *    its grants, and both row policies expressed as
 *    `users.<name>.databases.<db>.<table>.filter` (ClickHouse `users.d` has no
 *    row-policy form; the row filter is the supported shape, per the pre-PR Go
 *    renderer `infra/clickhouse-serverless/internal/render/lwql.go`).
 *  - `config.d/lwql-named-collection.yaml` — the PostgreSQL named collection
 *    the postgres-engine tables dial (its password is plaintext by necessity —
 *    ClickHouse must dial PostgreSQL with the real value).
 *
 * The YAML is serialised by a small local writer rather than a library: the only
 * shapes are nested maps, string/number scalars and a list of grant strings, and
 * every string value is double-quoted and escaped so a SQL predicate or a grant
 * that carries quotes, parentheses or a colon renders unambiguously.
 *
 * @see ./accessModelDefinition.ts — the typed definition this renders
 * @see ./accessModelDdl.ts — the SQL DDL emitter over the same definition
 * @see specs/lwql/access-model.feature
 */

import type {
  LwqlAccessModelDefinition,
  LwqlProfileSetting,
} from "./accessModelDefinition";

/** Relative path (under the render `--out` dir) of the users.d file. */
export const LWQL_USERS_D_RELATIVE_PATH = "users.d/lwql-access.yaml";
/** Relative path (under the render `--out` dir) of the config.d file. */
export const LWQL_CONFIG_D_RELATIVE_PATH =
  "config.d/lwql-named-collection.yaml";

/** The networks stanza: the restricted user may connect from anywhere on the pod network. */
const LWQL_USER_NETWORKS_IP = "::/0";

/** A rendered config file: its relative path and its contents. */
export interface RenderedConfigFile {
  readonly relativePath: string;
  readonly contents: string;
}

/** A YAML value the local writer serialises. */
type YamlValue = string | number | YamlValue[] | { [key: string]: YamlValue };

/** A double-quoted, escaped YAML scalar — safe for any predicate or grant text. */
function yamlString(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

/** Serialises a value tree as YAML with two-space indentation. */
function writeYaml(value: YamlValue, indent = 0): string {
  const pad = "  ".repeat(indent);
  if (typeof value === "number") return `${value}`;
  if (typeof value === "string") return yamlString(value);
  if (Array.isArray(value)) {
    if (value.length === 0) return "[]";
    return value
      .map(
        (item) =>
          `\n${pad}- ${writeYaml(item, indent + 1).replace(/^\s+/, "")}`,
      )
      .join("");
  }
  const entries = Object.entries(value);
  if (entries.length === 0) return "{}";
  return entries
    .map(([key, child]) => {
      const rendered = writeYaml(child, indent + 1);
      const isBlock =
        (typeof child === "object" &&
          child !== null &&
          !Array.isArray(child) &&
          Object.keys(child).length > 0) ||
        (Array.isArray(child) && child.length > 0);
      return isBlock
        ? `\n${pad}${key}:${rendered}`
        : `\n${pad}${key}: ${rendered}`;
    })
    .join("");
}

/** The YAML value for one profile setting: a number, or a quoted string. */
function settingYamlValue(setting: LwqlProfileSetting): YamlValue {
  if (!setting.quoted) return Number(setting.value);
  // An empty capability value is written as the two-character SQL empty literal
  // `''` so ClickHouse sets it to an empty string rather than treating an empty
  // scalar as unset — matching the pre-PR Go renderer.
  return setting.value === "" ? "''" : String(setting.value);
}

/** The `profiles.<name>` map: settings inline, constraints under `constraints`. */
function profileYaml(definition: LwqlAccessModelDefinition): YamlValue {
  const settings: Record<string, YamlValue> = {};
  const constraints: Record<string, YamlValue> = {};
  for (const setting of definition.profile.settings) {
    settings[setting.name] = settingYamlValue(setting);
    constraints[setting.name] = { [setting.constraint]: "" };
  }
  return { ...settings, constraints };
}

/** One grant as its `grants.query` string (no `TO`, the user owns the list). */
function grantQuery(
  grant: LwqlAccessModelDefinition["grants"][number],
): string {
  const select = grant.columns
    ? `SELECT(${grant.columns.map((column) => `\`${column}\``).join(", ")})`
    : "SELECT";
  return `GRANT ${select} ON ${grant.database}.${grant.table}`;
}

/** The `users.<name>.databases` tree: one `<table>.filter` per row policy. */
function databasesYaml(
  definition: LwqlAccessModelDefinition,
): Record<string, YamlValue> {
  const databases: Record<string, Record<string, YamlValue>> = {};
  for (const policy of definition.rowPolicies) {
    const tables = (databases[policy.database] ??= {});
    tables[policy.table] = { filter: policy.predicate };
  }
  return databases;
}

/** Renders `users.d/lwql-access.yaml` from the definition. */
export function renderLwqlUsersDConfig(
  definition: LwqlAccessModelDefinition,
): string {
  const tree: YamlValue = {
    profiles: { [definition.profile.name]: profileYaml(definition) },
    users: {
      [definition.user.name]: {
        password_sha256_hex: definition.user.passwordSha256Hex,
        networks: { ip: LWQL_USER_NETWORKS_IP },
        profile: definition.profile.name,
        grants: { query: definition.grants.map(grantQuery) },
        databases: databasesYaml(definition),
      },
    },
  };
  return `${writeYaml(tree).replace(/^\n/, "")}\n`;
}

/** Renders `config.d/lwql-named-collection.yaml` from the definition. */
export function renderLwqlNamedCollectionConfig(
  definition: LwqlAccessModelDefinition,
): string {
  const collection = definition.namedCollection;
  const tree: YamlValue = {
    named_collections: {
      [collection.collection]: {
        host: collection.host,
        port: collection.port,
        database: collection.database,
        user: collection.user,
        password: collection.password,
      },
    },
  };
  return `${writeYaml(tree).replace(/^\n/, "")}\n`;
}

/**
 * Both files the chart contract names, rendered from the shared definition.
 * Returned as data (path + contents) so the render task owns all I/O; nothing
 * here writes a file or logs, and no return value is ever logged (AC5).
 */
export function renderLwqlAccessModelUsersConfig(
  definition: LwqlAccessModelDefinition,
): RenderedConfigFile[] {
  return [
    {
      relativePath: LWQL_USERS_D_RELATIVE_PATH,
      contents: renderLwqlUsersDConfig(definition),
    },
    {
      relativePath: LWQL_CONFIG_D_RELATIVE_PATH,
      contents: renderLwqlNamedCollectionConfig(definition),
    },
  ];
}
