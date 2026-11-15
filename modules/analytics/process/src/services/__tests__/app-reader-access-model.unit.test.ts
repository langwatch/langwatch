import {
  APP_READER_NAMES,
  APP_READER_TENANT_TABLES,
  renderAppReaderUsersD,
} from "@langwatch/clickhouse-migrations";
/** The app reader inside the one access-model definition, through both emitters (ADR-202). */
import { load } from "js-yaml";
import { describe, expect, it } from "vitest";

import type { PostgresNamedCollection } from "../../features/provisioning/services/langwatch-ql-postgres-mapping.service.ts";
import { LangWatchQLAccessModelDefinitionService } from "../langwatch-ql-access-model-definition.service.ts";
import type { LangWatchQLNames } from "../langwatch-ql-access-model.service.ts";

const accessModelDefinition = LangWatchQLAccessModelDefinitionService.create();

const NAMES: LangWatchQLNames = {
  database: "langwatch",
  restrictedUser: "langwatch_lwql",
  settingsProfile: "langwatch_profile",
  keyMapTable: "lwql_api_key_tenant_map",
  tenantSetting: "custom_api_key_hash",
};

const NAMED_COLLECTION: PostgresNamedCollection = {
  collection: "lwql_postgres",
  host: "pg.internal",
  port: 5432,
  database: "langwatch",
  user: "lwql_ro",
  password: "pg-reader-secret",
};

const READER_HASH = "b".repeat(64);

function built(appReader?: {
  passwordSha256Hex: string;
  enforce?: boolean;
  enforcing?: { passwordSha256Hex: string };
}) {
  return accessModelDefinition.build({
    names: NAMES,
    passwordSha256Hex: "a".repeat(64),
    namedCollection: NAMED_COLLECTION,
    sourceDatabase: NAMES.database,
    ...(appReader ? { appReader } : {}),
  });
}

interface UsersD {
  profiles: Record<string, Record<string, unknown> & { constraints: Record<string, object> }>;
  users: Record<
    string,
    {
      password_sha256_hex: string;
      profile: string;
      grants: { query: string[] };
      databases: Record<string, Record<string, { filter: string }>>;
    }
  >;
}

/** The server-metadata reads the reader is granted, and no other system table (ADR-202). */
const SERVER_METADATA_GRANTS = [
  { database: "system", table: "columns" },
  { database: "system", table: "replicas" },
  { database: "system", table: "server_settings" },
];

describe("given the access-model definition built with the app reader's credential", () => {
  const definition = built({ passwordSha256Hex: READER_HASH });
  const reader = definition.appReader;
  if (!reader) throw new Error("the definition carries no app reader");
  const ddl = accessModelDefinition.renderDdl(definition);
  const usersD = load(accessModelDefinition.renderUsersD(definition)) as UsersD;
  const tenantPolicies = reader.rowPolicies.filter((p) => p.database === NAMES.database);
  const hiddenPolicies = reader.rowPolicies.filter((p) => p.database === "system");

  /** @scenario "The access model defines the app reader beside the LangWatchQL identity" */
  it("defines the reader and leaves the LangWatchQL identity as it renders without the reader", () => {
    expect(reader.user).toEqual({ name: "langwatch_app_reader", passwordSha256Hex: READER_HASH });
    expect(reader.profile.name).toBe("langwatch_app_reader_profile");
    const withoutReader = built();
    expect(ddl.slice(0, accessModelDefinition.renderDdl(withoutReader).length)).toEqual(
      accessModelDefinition.renderDdl(withoutReader),
    );
    expect(usersD.users[NAMES.restrictedUser]).toEqual(
      (load(accessModelDefinition.renderUsersD(withoutReader)) as UsersD).users[
        NAMES.restrictedUser
      ],
    );
  });

  /** @scenario "The app reader's profile starts with an empty tenant set and pins the rest" */
  it("starts the tenant set empty, pins enforce, the query cache and introspection CONST", () => {
    expect(reader.profile.settings).toEqual([
      {
        name: "SQL_langwatch_tenant_ids",
        value: "",
        quoted: true,
        constraint: "changeable_in_readonly",
      },
      { name: "SQL_langwatch_tenancy_enforce", value: "0", quoted: true, constraint: "const" },
      { name: "use_query_cache", value: 0, constraint: "const" },
      { name: "allow_introspection_functions", value: 0, constraint: "const" },
    ]);
    const enforcing = built({ passwordSha256Hex: READER_HASH, enforce: true }).appReader;
    expect(
      enforcing?.profile.settings.find(({ name }) => name === APP_READER_NAMES.enforceSetting),
    ).toEqual({
      name: "SQL_langwatch_tenancy_enforce",
      value: "1",
      quoted: true,
      constraint: "const",
    });
  });

  /** @scenario "Every app reader row policy admits only the request's tenants once enforced" */
  it("wraps each table's tenant column in the shadow switch and the non-empty tenant set", () => {
    const predicateFor = (column: string) =>
      "toString(getSetting('SQL_langwatch_tenancy_enforce')) = '0' OR " +
      "has(arrayFilter(tenant -> notEmpty(tenant), " +
      `splitByChar(',', getSetting('SQL_langwatch_tenant_ids'))), ${column})`;
    expect(tenantPolicies).toHaveLength(APP_READER_TENANT_TABLES.length);
    expect(tenantPolicies.length + hiddenPolicies.length).toBe(reader.rowPolicies.length);
    for (const policy of tenantPolicies) {
      const column = policy.table === "stored_objects" ? "project_id" : "TenantId";
      expect(policy).toEqual({
        name: `${policy.table}_app_tenant`,
        database: NAMES.database,
        table: policy.table,
        predicate: predicateFor(column),
      });
    }
  });

  /** @scenario "The app reader cannot read its own query log" */
  it("hides system.user_query_log behind a policy admitting no row, with no grant on it", () => {
    expect(hiddenPolicies).toEqual([
      {
        name: "user_query_log_app_hidden",
        database: "system",
        table: "user_query_log",
        predicate: "0",
      },
    ]);
    expect(reader.grants.filter(({ database }) => database === "system")).toEqual(
      SERVER_METADATA_GRANTS,
    );
    expect(reader.grants.some(({ table }) => table === "user_query_log")).toBe(false);
    expect(ddl).toContain(
      "CREATE ROW POLICY OR REPLACE user_query_log_app_hidden ON system.user_query_log\n" +
        "  USING 0\n  TO langwatch_app_reader",
    );
    expect(usersD.users[APP_READER_NAMES.user]?.databases.system?.user_query_log?.filter).toBe("0");
  });

  /** @scenario "Both emitters hide the restricted user's query log under a policy of its own" */
  it("names the LangWatchQL user's query-log policy apart from the reader's, so neither replaces the other", () => {
    const systemPolicyStatements = ddl.filter((statement) =>
      statement.startsWith("CREATE ROW POLICY OR REPLACE user_query_log_"),
    );
    expect(systemPolicyStatements).toEqual([
      "CREATE ROW POLICY OR REPLACE user_query_log_hidden_langwatch_lwql ON system.user_query_log\n" +
        "  USING 0\n  TO langwatch_lwql",
      "CREATE ROW POLICY OR REPLACE user_query_log_app_hidden ON system.user_query_log\n" +
        "  USING 0\n  TO langwatch_app_reader",
    ]);
  });

  /** @scenario "App reader policies never share a name with a LangWatchQL policy" */
  it("names no reader policy after a LangWatchQL policy on the same table", () => {
    const lwql = new Set(definition.rowPolicies.map((p) => `${p.database}.${p.table}:${p.name}`));
    const clashes = reader.rowPolicies.filter((p) =>
      lwql.has(`${p.database}.${p.table}:${p.name}`),
    );
    expect(clashes).toEqual([]);
    expect(definition.rowPolicies.some((p) => p.table === "stored_spans")).toBe(true);
  });

  /** @scenario "The app reader is granted SELECT on the tenant tables and the server-metadata tables, nothing else" */
  it("grants SELECT on exactly the tables its policies bound and the three server-metadata tables", () => {
    expect(reader.grants).toEqual([
      ...tenantPolicies.map(({ database, table }) => ({ database, table })),
      ...SERVER_METADATA_GRANTS,
    ]);
    const readerGrants = ddl.filter(
      (s) => s.startsWith("GRANT") && s.endsWith(" TO langwatch_app_reader"),
    );
    expect(readerGrants).toHaveLength(reader.grants.length);
    expect(readerGrants.filter((s) => !s.startsWith("GRANT SELECT ON langwatch."))).toEqual([
      "GRANT SELECT ON system.columns TO langwatch_app_reader",
      "GRANT SELECT ON system.replicas TO langwatch_app_reader",
      "GRANT SELECT ON system.server_settings TO langwatch_app_reader",
    ]);
  });

  /** @scenario "The DDL and users.d emitters render the same app reader" */
  it("renders the same reader user, profile, grants and policies from both emitters", () => {
    const yamlUser = usersD.users[APP_READER_NAMES.user];
    const yamlProfile = usersD.profiles[APP_READER_NAMES.settingsProfile];
    expect(yamlUser?.password_sha256_hex).toBe(READER_HASH);
    expect(yamlUser?.profile).toBe(APP_READER_NAMES.settingsProfile);
    expect(ddl).toContain(
      `CREATE USER OR REPLACE langwatch_app_reader IDENTIFIED WITH sha256_hash BY '${READER_HASH}' ` +
        "SETTINGS PROFILE langwatch_app_reader_profile",
    );
    const ddlProfile = ddl.find((s) =>
      s.includes("PROFILE OR REPLACE langwatch_app_reader_profile"),
    );
    for (const setting of reader.profile.settings) {
      const literal = setting.quoted ? `'${setting.value}'` : `${setting.value}`;
      const constraint = setting.constraint === "const" ? "CONST" : "CHANGEABLE_IN_READONLY";
      expect(ddlProfile).toContain(`${setting.name} = ${literal} ${constraint}`);
      // A config file reads a custom setting as a Field dump: a string keeps its quotes.
      expect(String(yamlProfile?.[setting.name])).toBe(
        setting.quoted ? `'${setting.value}'` : String(setting.value),
      );
      expect(Object.keys(yamlProfile?.constraints[setting.name] ?? {})).toEqual([
        setting.constraint,
      ]);
    }
    expect(yamlUser?.grants.query).toEqual(
      reader.grants.map(({ database, table }) => `GRANT SELECT ON ${database}.${table}`),
    );
    for (const policy of reader.rowPolicies) {
      expect(yamlUser?.databases[policy.database]?.[policy.table]?.filter).toBe(policy.predicate);
      expect(ddl).toContain(
        `CREATE ROW POLICY OR REPLACE ${policy.name} ON ${policy.database}.${policy.table}\n` +
          `  USING ${policy.predicate}\n  TO langwatch_app_reader`,
      );
    }
  });

  /** @scenario "No row policy binds the system identity" */
  it("binds every policy to the LangWatchQL user or the app reader only", () => {
    const boundTo = ddl
      .filter((s) => s.startsWith("CREATE ROW POLICY"))
      .map((s) => s.slice(s.lastIndexOf("\n  TO ") + "\n  TO ".length));
    expect(new Set(boundTo)).toEqual(new Set([NAMES.restrictedUser, APP_READER_NAMES.user]));
    const yamlPolicyHolders = Object.entries(usersD.users)
      .filter(([, user]) => Object.keys(user.databases ?? {}).length > 0)
      .map(([name]) => name);
    expect(yamlPolicyHolders.toSorted()).toEqual(
      [NAMES.restrictedUser, APP_READER_NAMES.user].toSorted(),
    );
  });
});

describe("given the access-model definition built with the enforcing reader's credential", () => {
  const ENFORCING_HASH = "c".repeat(64);
  const definition = built({
    passwordSha256Hex: READER_HASH,
    enforcing: { passwordSha256Hex: ENFORCING_HASH },
  });
  const { appReader: reader, appReaderEnforcing: enforcing } = definition;
  if (!reader || !enforcing) throw new Error("the definition carries no enforcing reader");
  const ddl = accessModelDefinition.renderDdl(definition);
  const usersD = load(accessModelDefinition.renderUsersD(definition)) as UsersD;
  const enforceOf = (identity: typeof reader) =>
    identity.profile.settings.find(({ name }) => name === APP_READER_NAMES.enforceSetting);

  /** @scenario "The access model defines the shadow sampler's enforcing reader beside the app reader" */
  it("defines the enforcing reader with enforce pinned on, leaving the app reader in shadow", () => {
    expect(enforcing.user).toEqual({
      name: "langwatch_app_reader_enforcing",
      passwordSha256Hex: ENFORCING_HASH,
    });
    expect(enforcing.profile.name).toBe("langwatch_app_reader_enforcing_profile");
    expect(enforceOf(enforcing)).toMatchObject({ value: "1", constraint: "const" });
    expect(enforceOf(reader)).toMatchObject({ value: "0", constraint: "const" });
    expect(enforcing.grants).toEqual(reader.grants);
    expect(enforcing.rowPolicies.map(({ predicate }) => predicate)).toEqual(
      reader.rowPolicies.map(({ predicate }) => predicate),
    );
    const withoutEnforcing = accessModelDefinition.renderDdl(
      built({ passwordSha256Hex: READER_HASH }),
    );
    expect(ddl.slice(0, withoutEnforcing.length)).toEqual(withoutEnforcing);
  });

  /** @scenario "The access model defines the shadow sampler's enforcing reader beside the app reader" */
  it("renders it from both emitters under policy names that never replace the app reader's", () => {
    const readerNames = new Set(reader.rowPolicies.map(({ name }) => name));
    for (const policy of enforcing.rowPolicies) {
      expect(readerNames.has(policy.name)).toBe(false);
      expect(ddl).toContain(
        `CREATE ROW POLICY OR REPLACE ${policy.name} ON ${policy.database}.${policy.table}\n` +
          `  USING ${policy.predicate}\n  TO langwatch_app_reader_enforcing`,
      );
    }
    expect(ddl).toContain(
      "CREATE USER OR REPLACE langwatch_app_reader_enforcing IDENTIFIED WITH sha256_hash BY " +
        `'${ENFORCING_HASH}' SETTINGS PROFILE langwatch_app_reader_enforcing_profile`,
    );
    const yamlUser = usersD.users["langwatch_app_reader_enforcing"];
    expect(yamlUser?.profile).toBe("langwatch_app_reader_enforcing_profile");
    expect(yamlUser?.databases).toEqual(usersD.users[APP_READER_NAMES.user]?.databases);
    expect(
      String(
        usersD.profiles["langwatch_app_reader_enforcing_profile"]?.[
          APP_READER_NAMES.enforceSetting
        ],
      ),
    ).toBe("'1'");
  });

  /** @scenario "The DDL and users.d emitters render the same app reader" */
  it("renders the readers alone as users.d with the entries the full users.d gives them", () => {
    const alone = load(
      renderAppReaderUsersD({
        sourceDatabase: NAMES.database,
        appReader: {
          passwordSha256Hex: READER_HASH,
          enforcing: { passwordSha256Hex: ENFORCING_HASH },
        },
      }),
    ) as UsersD;
    const readerNames = [APP_READER_NAMES.user, "langwatch_app_reader_enforcing"];
    expect(Object.keys(alone.users)).toEqual(readerNames);
    for (const name of readerNames) expect(alone.users[name]).toEqual(usersD.users[name]);
    for (const profile of Object.keys(alone.profiles)) {
      expect(alone.profiles[profile]).toEqual(usersD.profiles[profile]);
    }
    expect(alone.users[NAMES.restrictedUser]).toBeUndefined();
  });
});
