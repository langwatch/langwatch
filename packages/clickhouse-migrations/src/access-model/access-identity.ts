/**
 * One ClickHouse identity (its user, settings profile, grants and row policies) and its two
 * emitters: SQL DDL for a SQL access store, a users.d document for a config-store server. Every
 * identity the upgrade provisions renders through these, so the two cannot disagree (ADR-202).
 */

/** A database, table, user, profile or setting name: never caller text in a statement. */
const SAFE_IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** The networks a config-store user is accepted from; the credential is what admits it. */
const USER_NETWORKS_IP = "::/0";

/** One settings-profile entry; `quoted` values are strings, the rest numbers. */
export interface AccessProfileSetting {
  readonly name: string;
  readonly value: string | number;
  readonly quoted?: boolean;
  readonly constraint: "const" | "changeable_in_readonly";
}

/** A SELECT grant, or an INSERT one; `columns` narrows a SELECT to a column list. */
export interface AccessGrant {
  readonly database: string;
  readonly table: string;
  readonly columns?: readonly string[];
  readonly privilege?: "INSERT";
}

export interface AccessRowPolicy {
  readonly name: string;
  readonly database: string;
  readonly table: string;
  readonly predicate: string;
}

/** One ClickHouse identity: its user, the profile it carries, its grants and row policies. */
export interface AccessIdentity {
  readonly user: { readonly name: string; readonly passwordSha256Hex: string };
  readonly profile: { readonly name: string; readonly settings: readonly AccessProfileSetting[] };
  readonly grants: readonly AccessGrant[];
  readonly rowPolicies: readonly AccessRowPolicy[];
}

/** Returns `value` when it is a safe identifier; `role` names the configured name refused. */
export function assertAccessIdentifier({ value, role }: { value: string; role: string }): string {
  if (!SAFE_IDENTIFIER.test(value)) {
    throw new Error(`access model: ${role} must match ${String(SAFE_IDENTIFIER)}, got "${value}"`);
  }
  return value;
}

/** A YAML tree the config-store documents are written from. */
export type YamlValue = string | number | YamlValue[] | { [key: string]: YamlValue };

function yamlString(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

function writeYaml(value: YamlValue, indent = 0): string {
  const pad = "  ".repeat(indent);
  if (typeof value === "number") return `${value}`;
  if (typeof value === "string") return yamlString(value);
  if (Array.isArray(value)) {
    if (value.length === 0) return "[]";
    return value
      .map((item) => `\n${pad}- ${writeYaml(item, indent + 1).replace(/^\s+/, "")}`)
      .join("");
  }
  const entries = Object.entries(value);
  if (entries.length === 0) return "{}";
  return entries
    .map(([key, child]) => {
      const rendered = writeYaml(child, indent + 1);
      const isBlock =
        (typeof child === "object" && !Array.isArray(child) && Object.keys(child).length > 0) ||
        (Array.isArray(child) && child.length > 0);
      return isBlock ? `\n${pad}${key}:${rendered}` : `\n${pad}${key}: ${rendered}`;
    })
    .join("");
}

/** A YAML document over `tree`, as a config-store ClickHouse merges it at boot. */
export function yamlDocument({ tree }: { tree: YamlValue }): string {
  return `${writeYaml(tree).replace(/^\n/, "")}\n`;
}

/** Config files carry a custom setting as a Field dump, so a string one keeps its quotes. */
function settingYamlValue({
  setting,
  customSettingsPrefixes,
}: {
  setting: AccessProfileSetting;
  customSettingsPrefixes: readonly string[];
}): YamlValue {
  if (!setting.quoted) return Number(setting.value);
  const custom = customSettingsPrefixes.some((prefix) => setting.name.startsWith(prefix));
  if (custom) return `'${setting.value}'`;
  return setting.value === "" ? "''" : String(setting.value);
}

function privilegeClause(grant: AccessGrant): string {
  if (grant.privilege === "INSERT") return "INSERT";
  return grant.columns
    ? `SELECT(${grant.columns.map((column) => `\`${column}\``).join(", ")})`
    : "SELECT";
}

function settingLiteral(setting: AccessProfileSetting): string {
  return setting.quoted ? `'${setting.value}'` : `${setting.value}`;
}

function settingConstraint(setting: AccessProfileSetting): string {
  return setting.constraint === "changeable_in_readonly" ? "CHANGEABLE_IN_READONLY" : "CONST";
}

/** Profile, user, row policies, then grants: the order a SQL access store needs. */
export function renderIdentityDdl({ identity }: { identity: AccessIdentity }): string[] {
  const user = identity.user.name;
  const settings = identity.profile.settings
    .map((setting) => `${setting.name} = ${settingLiteral(setting)} ${settingConstraint(setting)}`)
    .join(",\n           ");
  return [
    `CREATE SETTINGS PROFILE OR REPLACE ${identity.profile.name}\n  SETTINGS ${settings}`,
    `CREATE USER OR REPLACE ${user} ` +
      `IDENTIFIED WITH sha256_hash BY '${identity.user.passwordSha256Hex}' ` +
      `SETTINGS PROFILE ${identity.profile.name}`,
    ...identity.rowPolicies.map(
      (policy) =>
        `CREATE ROW POLICY OR REPLACE ${policy.name} ON ${policy.database}.${policy.table}\n` +
        `  USING ${policy.predicate}\n` +
        `  TO ${user}`,
    ),
    ...identity.grants.map(
      (grant) => `GRANT ${privilegeClause(grant)} ON ${grant.database}.${grant.table} TO ${user}`,
    ),
  ];
}

/**
 * One profile and one user per identity, in order, in a single users.d document. A quoted setting
 * whose name starts with one of `customSettingsPrefixes` keeps its quotes, as the server reads it.
 */
export function renderIdentitiesUsersD({
  identities,
  customSettingsPrefixes,
}: {
  identities: readonly AccessIdentity[];
  customSettingsPrefixes: readonly string[];
}): string {
  const profiles: Record<string, YamlValue> = {};
  const users: Record<string, YamlValue> = {};
  for (const identity of identities) {
    const settings: Record<string, YamlValue> = {};
    const constraints: Record<string, YamlValue> = {};
    for (const setting of identity.profile.settings) {
      settings[setting.name] = settingYamlValue({ setting, customSettingsPrefixes });
      constraints[setting.name] = { [setting.constraint]: "" };
    }
    const databases: Record<string, Record<string, YamlValue>> = {};
    for (const policy of identity.rowPolicies) {
      const tables = (databases[policy.database] ??= {});
      tables[policy.table] = { filter: policy.predicate };
    }
    profiles[identity.profile.name] = { ...settings, constraints };
    users[identity.user.name] = {
      password_sha256_hex: identity.user.passwordSha256Hex,
      networks: { ip: USER_NETWORKS_IP },
      profile: identity.profile.name,
      grants: {
        query: identity.grants.map(
          (grant) => `GRANT ${privilegeClause(grant)} ON ${grant.database}.${grant.table}`,
        ),
      },
      databases,
    };
  }
  return yamlDocument({ tree: { profiles, users } });
}
