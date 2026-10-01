/** The SQL and YAML emitters grant, police and configure exactly the same model (ADR-159). */
import { load } from "js-yaml";
import { describe, expect, it } from "vitest";

import {
  LangWatchQLAccessModelDefinitionService,
  type LwqlAccessModelDefinition,
} from "../langwatch-ql-access-model-definition.service.ts";
import type { LangWatchQLNames } from "../langwatch-ql-access-model.service.ts";
import type { PostgresNamedCollection } from "../langwatch-ql-postgres-mapping.service.ts";

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

const HEX = "a".repeat(64);

interface Projection {
  user: { name: string; passwordSha256Hex: string };
  profile: {
    name: string;
    settings: Record<string, { value: string; constraint: string }>;
  };
  grants: string[];
  policies: string[];
  namedCollection: Record<string, string>;
}

/** Strips one matching pair of surrounding single quotes, so `''` → `` and `'throw'` → `throw`. */
function normalizeValue(raw: string): string {
  return raw.replace(/^'(.*)'$/, "$1");
}

function projectDefinition(definition: LwqlAccessModelDefinition): Projection {
  const settings: Projection["profile"]["settings"] = {};
  for (const setting of definition.profile.settings) {
    settings[setting.name] = {
      value: normalizeValue(String(setting.value)),
      constraint: setting.constraint,
    };
  }
  return {
    user: {
      name: definition.user.name,
      passwordSha256Hex: definition.user.passwordSha256Hex,
    },
    profile: { name: definition.profile.name, settings },
    grants: definition.grants
      .map((g) => `${g.database}.${g.table}(${(g.columns ?? []).join(",")})`)
      .toSorted(),
    policies: definition.rowPolicies
      .map((p) => `${p.database}.${p.table}=${p.predicate}`)
      .toSorted(),
    namedCollection: {
      collection: definition.namedCollection.collection,
      host: definition.namedCollection.host,
      port: String(definition.namedCollection.port),
      database: definition.namedCollection.database,
      user: definition.namedCollection.user,
      password: definition.namedCollection.password,
    },
  };
}

function projectDdl(statements: string[]): Projection {
  const profileStmt = statements.find((s) => s.startsWith("CREATE SETTINGS PROFILE"));
  const userStmt = statements.find((s) => s.startsWith("CREATE USER"));
  if (!profileStmt || !userStmt) throw new Error("DDL missing profile/user");

  const [profileHead, ...settingLines] = profileStmt.split("\n");
  if (profileHead === undefined) throw new Error("DDL profile statement empty");
  const profileName = profileHead.replace("CREATE SETTINGS PROFILE OR REPLACE ", "").trim();
  const settings: Projection["profile"]["settings"] = {};
  for (const line of settingLines) {
    const match = line
      .replace(/^\s*SETTINGS\s+/, "")
      .replace(/,\s*$/, "")
      .trim()
      .match(/^(\S+) = (.+) (CONST|CHANGEABLE_IN_READONLY)$/);
    if (!match) continue;
    const [, settingName, rawValue, constraintToken] = match;
    if (settingName === undefined || rawValue === undefined || constraintToken === undefined) {
      continue;
    }
    settings[settingName] = {
      value: normalizeValue(rawValue),
      constraint: constraintToken === "CONST" ? "const" : "changeable_in_readonly",
    };
  }

  const userMatch = userStmt.match(
    /CREATE USER OR REPLACE (\S+) IDENTIFIED WITH sha256_hash BY '([0-9a-f]+)'/,
  );
  const userName = userMatch?.[1];
  const userPasswordSha256Hex = userMatch?.[2];
  if (userName === undefined || userPasswordSha256Hex === undefined) {
    throw new Error("DDL user statement unparseable");
  }

  const grants = statements
    .filter((s) => s.startsWith("GRANT SELECT"))
    .map((s) => {
      const m = s.match(/^GRANT SELECT(?:\(([^)]*)\))? ON ([^\s.]+)\.(\S+) TO /);
      if (!m) throw new Error(`grant unparseable: ${s}`);
      const columns = m[1] ? m[1].split(", ").map((c) => c.replace(/`/g, "")) : [];
      return `${m[2]}.${m[3]}(${columns.join(",")})`;
    })
    .toSorted();

  const policies = statements
    .filter((s) => s.startsWith("CREATE ROW POLICY"))
    .map((s) => {
      const m = s.match(
        /CREATE ROW POLICY OR REPLACE \S+ ON ([^\s.]+)\.(\S+)\n {2}USING (.+)\n {2}TO /s,
      );
      if (!m) throw new Error(`policy unparseable: ${s}`);
      return `${m[1]}.${m[2]}=${m[3]}`;
    })
    .toSorted();

  const ncStmt = statements.find((s) => s.startsWith("CREATE NAMED COLLECTION"));
  if (!ncStmt) throw new Error("DDL missing named collection");
  const ncName = ncStmt.match(/CREATE NAMED COLLECTION (\S+) AS/)?.[1] ?? "";
  const field = (name: string): string =>
    ncStmt.match(new RegExp(`${name}=('([^']*)'|\\d+)`))?.[2] ??
    ncStmt.match(new RegExp(`${name}=(\\d+)`))?.[1] ??
    "";

  return {
    user: { name: userName, passwordSha256Hex: userPasswordSha256Hex },
    profile: { name: profileName, settings },
    grants,
    policies,
    namedCollection: {
      collection: ncName,
      host: field("host"),
      port: field("port"),
      database: field("database"),
      user: field("user"),
      password: field("password"),
    },
  };
}

function projectYaml(usersYaml: string, namedCollectionYaml: string): Projection {
  const users = load(usersYaml) as {
    profiles: Record<
      string,
      Record<string, unknown> & {
        constraints: Record<string, Record<string, string>>;
      }
    >;
    users: Record<
      string,
      {
        password_sha256_hex: string;
        grants: { query: string[] };
        databases: Record<string, Record<string, { filter: string }>>;
      }
    >;
  };
  const nc = load(namedCollectionYaml) as {
    named_collections: Record<string, Record<string, string | number>>;
  };

  const profileEntry = Object.entries(users.profiles)[0];
  if (!profileEntry) throw new Error("users yaml has no profile");
  const [profileName, profile] = profileEntry;
  const settings: Projection["profile"]["settings"] = {};
  for (const [name, raw] of Object.entries(profile)) {
    if (name === "constraints") continue;
    const constraint = Object.keys(profile.constraints[name] ?? {})[0] ?? "";
    settings[name] = { value: normalizeValue(String(raw)), constraint };
  }

  const userEntry = Object.entries(users.users)[0];
  if (!userEntry) throw new Error("users yaml has no user");
  const [userName, user] = userEntry;
  const grants = user.grants.query
    .map((q) => {
      const m = q.match(/^GRANT SELECT(?:\(([^)]*)\))? ON ([^\s.]+)\.(\S+)$/);
      if (!m) throw new Error(`yaml grant unparseable: ${q}`);
      const columns = m[1] ? m[1].split(", ").map((c) => c.replace(/`/g, "")) : [];
      return `${m[2]}.${m[3]}(${columns.join(",")})`;
    })
    .toSorted();

  const policies = Object.entries(user.databases)
    .flatMap(([db, tables]) =>
      Object.entries(tables).map(([table, { filter }]) => `${db}.${table}=${filter}`),
    )
    .toSorted();

  const ncEntry = Object.entries(nc.named_collections)[0];
  if (!ncEntry) throw new Error("named collection yaml has no entry");
  const [ncName, ncFields] = ncEntry;

  return {
    user: { name: userName, passwordSha256Hex: user.password_sha256_hex },
    profile: { name: profileName, settings },
    grants,
    policies,
    namedCollection: {
      collection: ncName,
      host: String(ncFields.host),
      port: String(ncFields.port),
      database: String(ncFields.database),
      user: String(ncFields.user),
      password: String(ncFields.password),
    },
  };
}

describe("LangWatchQL access-model emitter parity", () => {
  const definition = accessModelDefinition.build({
    names: NAMES,
    passwordSha256Hex: HEX,
    namedCollection: NAMED_COLLECTION,
    sourceDatabase: NAMES.database,
  });
  const expected = projectDefinition(definition);
  const fromDdl = projectDdl([
    ...accessModelDefinition.renderDdl(definition),
    ...accessModelDefinition.renderNamedCollectionDdl(definition),
  ]);
  const fromYaml = projectYaml(
    accessModelDefinition.renderUsersD(definition),
    accessModelDefinition.renderNamedCollectionConfig(definition),
  );

  describe("when both emitters render the same definition", () => {
    /** @scenario "The DDL emitter and the users.d emitter name the same user, profile, settings and constraints" */
    it("the DDL names the same user and password hash the definition holds", () => {
      expect(fromDdl.user).toEqual(expected.user);
      expect(fromYaml.user).toEqual(expected.user);
    });

    it("the profile settings and constraints match on both sides", () => {
      expect(fromDdl.profile).toEqual(expected.profile);
      expect(fromYaml.profile).toEqual(expected.profile);
    });

    /** @scenario "The DDL emitter and the users.d emitter grant the same objects" */
    it("the granted objects and their columns match on both sides", () => {
      expect(fromDdl.grants).toEqual(expected.grants);
      expect(fromYaml.grants).toEqual(expected.grants);
      expect(fromYaml.grants.length).toBeGreaterThan(1);
    });

    /** @scenario "The DDL emitter and the users.d emitter carry the same row policies and predicates" */
    it("the row policies and predicates match on both sides", () => {
      expect(fromDdl.policies).toEqual(expected.policies);
      expect(fromYaml.policies).toEqual(expected.policies);
    });

    /** @scenario "The named collection fields are identical between the two emitters" */
    it("the named-collection fields match on both sides", () => {
      expect(fromDdl.namedCollection).toEqual(expected.namedCollection);
      expect(fromYaml.namedCollection).toEqual(expected.namedCollection);
    });
  });
});
