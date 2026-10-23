import { describe, expect, it } from "vitest";

import type { LangWatchQLNames } from "../../../../services/langwatch-ql-access-model.service.ts";
import { lwqlAppFunctionNames } from "../../../app-functions/rules/langwatch-ql-app-function-catalog.rules.ts";
import { canProvisionAppFunctions } from "../../../app-functions/rules/langwatch-ql-app-function-store.rules.ts";
import { LangWatchQLPostgresMappingService } from "../langwatch-ql-postgres-mapping.service.ts";
import { LangWatchQLSelfProvisioningService } from "../langwatch-ql-self-provisioning.service.ts";

const selfProvisioning = LangWatchQLSelfProvisioningService.create();
const postgresMapping = LangWatchQLPostgresMappingService.create();

const SOURCE_DATABASE = "langwatch";
const NAMES: LangWatchQLNames = {
  database: SOURCE_DATABASE,
  restrictedUser: "langwatch_lwql",
  settingsProfile: "langwatch_profile",
  keyMapTable: "lwql_api_key_tenant_map",
  tenantSetting: "custom_api_key_hash",
};
const POSTGRES = {
  endpoint: { host: "pg", port: 5432, database: "langwatch" },
  readerPassword: "reader-secret",
};
const SELF_PROVISION_SOURCE = {
  CLICKHOUSE_URL: "http://admin:admin-secret@clickhouse:8123/langwatch",
  LWQL_CLICKHOUSE_PASSWORD: "restricted-secret",
  LWQL_POSTGRES_READER_PASSWORD: "reader-secret",
  DATABASE_URL: "postgresql://app:app-secret@postgres/langwatch?schema=public",
};

function statementsWith({ includeAppFunctions }: { includeAppFunctions?: boolean }): string[] {
  return selfProvisioning.clickHouseStatements({
    names: NAMES,
    restrictedPassword: "restricted-secret",
    sourceDatabase: SOURCE_DATABASE,
    postgres: POSTGRES,
    ...(includeAppFunctions === undefined ? {} : { includeAppFunctions }),
  });
}

describe("given a self-hosted ClickHouse with more than one replica", () => {
  describe("when it has no user_defined_zookeeper_path", () => {
    /** @scenario "A multi-replica server without a shared function store is provisioned without the functions" */
    it("is provisioned without the app functions but with the rest of the access model", () => {
      expect(canProvisionAppFunctions({ maxTotalReplicas: 3, userDefinedZookeeperPath: "" })).toBe(
        false,
      );

      const statements = statementsWith({ includeAppFunctions: false });

      expect(statements.some((s) => s.startsWith("CREATE OR REPLACE FUNCTION"))).toBe(false);
      expect(statements.some((s) => s.startsWith("CREATE USER"))).toBe(true);
    });
  });
});

describe("given a single-node ClickHouse", () => {
  describe("when self-provisioning runs", () => {
    /** @scenario "A single-node server is provisioned with the functions" */
    it("creates the app functions on its local store", () => {
      expect(canProvisionAppFunctions({ maxTotalReplicas: 0, userDefinedZookeeperPath: "" })).toBe(
        true,
      );

      expect(statementsWith({}).some((s) => s.startsWith("CREATE OR REPLACE FUNCTION"))).toBe(true);
    });
  });
});

describe("the self-provisioned ClickHouse statements", () => {
  it("refuses a LangWatchQL database other than the application's own", () => {
    expect(() =>
      selfProvisioning.clickHouseStatements({
        names: { ...NAMES, database: "elsewhere" },
        restrictedPassword: "pw",
        sourceDatabase: SOURCE_DATABASE,
        postgres: POSTGRES,
      }),
    ).toThrow(/application's own ClickHouse database/);
  });

  it("creates the restricted user before every grant, and the collection before the engine tables", () => {
    // SQL mode: structural, collection, engine tables, views, then the access model DDL.
    const statements = statementsWith({});
    const user = statements.findIndex((s) => s.startsWith("CREATE USER"));
    const firstGrant = statements.findIndex((s) => s.startsWith("GRANT"));
    const collection = statements.findIndex((s) => s.startsWith("CREATE NAMED COLLECTION"));
    const firstEngineTable = statements.findIndex((s) => s.includes("ENGINE = PostgreSQL"));

    expect(user).toBeGreaterThanOrEqual(0);
    expect(user).toBeLessThan(firstGrant);
    expect(firstEngineTable).toBeGreaterThan(collection);
  });

  it("dials PostgreSQL as the lwql_ro reader, never the application's admin", () => {
    const collection =
      statementsWith({}).find((s) => s.startsWith("CREATE NAMED COLLECTION")) ?? "";

    expect(collection).toContain("lwql_ro");
    expect(collection).not.toContain("app-secret");
  });
});

describe("given two stacks whose databases share one ClickHouse server", () => {
  const statementsFor = (database: string) =>
    selfProvisioning.clickHouseStatements({
      names: { ...NAMES, database },
      restrictedPassword: "pw",
      sourceDatabase: database,
      postgres: { ...POSTGRES, endpoint: { ...POSTGRES.endpoint, database } },
    });

  /** @scenario "Each ClickHouse database provisions its own named collection" */
  it("gives each database its own named collection, and its engine tables read only that one", () => {
    const [a, b] = [statementsFor("lw_a"), statementsFor("lw_b")];

    expect(a).toContain("DROP NAMED COLLECTION IF EXISTS lwql_postgres_lw_a");
    expect(b).toContain("DROP NAMED COLLECTION IF EXISTS lwql_postgres_lw_b");
    expect(a.some((s) => s.includes("lwql_postgres_lw_b"))).toBe(false);
    const engineTables = a.filter((s) => s.includes("ENGINE = PostgreSQL"));
    expect(engineTables.length).toBeGreaterThan(0);
    for (const table of engineTables) {
      expect(table).toContain("ENGINE = PostgreSQL(lwql_postgres_lw_a,");
    }
  });
});

describe("when the self-provisioning environment is read", () => {
  it("is not requested without LWQL_CLICKHOUSE_PASSWORD", () => {
    expect(selfProvisioning.request({ source: {} })).toEqual({ requested: false });
  });

  /** @scenario "Provisioning no longer reads a self-provision switch" */
  it("derives the connection from the password and URL, ignoring any self-provision switch", () => {
    for (const LWQL_SELF_PROVISION of [undefined, "false", "true"]) {
      expect(
        selfProvisioning.request({ source: { ...SELF_PROVISION_SOURCE, LWQL_SELF_PROVISION } }),
      ).toMatchObject({ requested: true, complete: true });
    }
  });

  it("declines, rather than demotes, a request whose reader password is missing", () => {
    const { LWQL_POSTGRES_READER_PASSWORD: _omitted, ...source } = SELF_PROVISION_SOURCE;

    expect(selfProvisioning.request({ source })).toEqual({
      requested: true,
      complete: false,
      missing: "LWQL_POSTGRES_READER_PASSWORD",
    });
  });

  it("derives the connection and the PostgreSQL endpoint from the application's own URLs", () => {
    const request = selfProvisioning.request({ source: SELF_PROVISION_SOURCE });

    expect(request).toMatchObject({
      requested: true,
      complete: true,
      connection: {
        url: "http://clickhouse:8123/",
        username: "langwatch_lwql",
        database: "langwatch",
      },
      endpoint: { host: "postgres", port: 5432, database: "langwatch" },
    });
  });
});

describe("the host the named collection dials", () => {
  const source = {
    ...SELF_PROVISION_SOURCE,
    DATABASE_URL: "postgresql://a:b@127.0.0.1:5433/langwatch",
  };

  /** @scenario "The named collection dials the database URL's host by default" */
  it("is the database URL's host when LWQL_POSTGRES_HOST is unset", () => {
    expect(selfProvisioning.request({ source })).toMatchObject({
      endpoint: { host: "127.0.0.1", port: 5433, database: "langwatch" },
    });
  });

  /** @scenario "LWQL_POSTGRES_HOST overrides the host the named collection dials" */
  it("is LWQL_POSTGRES_HOST when set, keeping the URL's port and database", () => {
    expect(
      selfProvisioning.request({ source: { ...source, LWQL_POSTGRES_HOST: "host.lima.internal" } }),
    ).toMatchObject({
      endpoint: { host: "host.lima.internal", port: 5433, database: "langwatch" },
    });
  });
});

describe("the PostgreSQL reader role", () => {
  describe("when the access model is provisioned", () => {
    it("converges lwql_ro with its password and approved-view grants on every path", () => {
      const statements = selfProvisioning.postgresReaderStatements({
        readerPassword: "reader-secret",
        schema: "public",
      });

      expect(statements.some((s) => s.includes('CREATE ROLE "lwql_ro" LOGIN'))).toBe(true);
      expect(statements.some((s) => s.startsWith('ALTER ROLE "lwql_ro" WITH LOGIN PASSWORD'))).toBe(
        true,
      );
    });
  });
});

describe("when the access-model mode is read", () => {
  it("renders by default and runs SQL DDL only when asked", () => {
    expect(selfProvisioning.accessModelMode({ source: {} })).toBe("rendered");
    expect(selfProvisioning.accessModelMode({ source: { LWQL_ACCESS_MODEL_MODE: "sql" } })).toBe(
      "sql",
    );
  });
});

describe("given the self-provisioned access model whose DDL embeds passwords", () => {
  describe("when a statement fails and the error echoes that DDL", () => {
    /** @scenario "A failed self-provisioning run is logged without leaking a password" */
    it("redacts the passwords and connection strings, and never matches an empty secret", () => {
      const text =
        "CREATE USER langwatch_lwql IDENTIFIED WITH sha256_password BY 'restricted-secret' via http://admin:admin-secret@clickhouse:8123/langwatch";

      const redacted = selfProvisioning.redactSecrets({
        text,
        secrets: [
          "restricted-secret",
          "http://admin:admin-secret@clickhouse:8123/langwatch",
          "",
          undefined,
        ],
      });

      expect(redacted).not.toContain("restricted-secret");
      expect(redacted).not.toContain("admin-secret");
      expect(redacted).toContain("CREATE USER langwatch_lwql");
    });
  });
});

describe("given the rendered-mode statements a converge runs", () => {
  /** @scenario "A failed converge never removes a working engine table" */
  it("replaces each engine table in one statement and drops no app-owned table or view", () => {
    const statements = selfProvisioning.clickHouseStatements({
      names: NAMES,
      restrictedPassword: "restricted-secret",
      sourceDatabase: SOURCE_DATABASE,
      postgres: POSTGRES,
      mode: "rendered",
    });
    const engineTables = statements.filter((s) => s.includes("ENGINE = PostgreSQL"));

    expect(engineTables.length).toBeGreaterThan(0);
    for (const table of engineTables) expect(table).toMatch(/^CREATE OR REPLACE TABLE /);
    expect(statements.filter((s) => /^\s*DROP\s+(TABLE|VIEW)\b/i.test(s))).toEqual([]);
  });
});

describe("given what the reconvergence check finds in ClickHouse", () => {
  const relations = selfProvisioning.appOwnedRelations({ names: NAMES });
  const fingerprint = selfProvisioning.credentialFingerprint({ names: NAMES, postgres: POSTGRES });
  const current = postgresMapping.credentialComment({ fingerprint });
  const drift = (
    found: string[],
    functions: string[] = ["lwql_trace"],
    comments: Record<string, string> = Object.fromEntries(found.map((name) => [name, current])),
  ) =>
    selfProvisioning.findDrift({
      names: NAMES,
      relations,
      functions: ["lwql_trace"],
      found: { relations: found, functions, comments },
      credentialFingerprint: fingerprint,
    });

  /** @scenario "The reconvergence check converges nothing while every app-owned LangWatchQL object is in place" */
  it("finds nothing when every relation and every function exists", () => {
    expect(drift(relations)).toEqual({ objects: [], isKeyMapMissing: false });
  });

  /** @scenario "The reconvergence check converges the app-owned LangWatchQL objects it finds missing" */
  it("names a missing engine table, a missing view, a missing function and the key map", () => {
    const engineTable = relations.find((name) => name.endsWith("_pg"));
    const view = relations.at(-1);
    if (!engineTable || !view) throw new Error("the catalog maps no PostgreSQL dataset");
    const found = relations.filter(
      (name) => ![engineTable, view, NAMES.keyMapTable].includes(name),
    );

    expect(drift(found, [])).toEqual({
      objects: [NAMES.keyMapTable, engineTable, view, "lwql_trace"],
      isKeyMapMissing: true,
    });
  });

  describe("when an engine table was built on other credentials, or before it was stamped", () => {
    const engineTables = relations.filter((name) => name.endsWith("_pg"));
    const [rotated, unstamped] = engineTables;
    const stale = postgresMapping.credentialComment({
      fingerprint: selfProvisioning.credentialFingerprint({
        names: NAMES,
        postgres: { ...POSTGRES, readerPassword: "the-password-before-rotation" },
      }),
    });

    /** @scenario "The reconvergence check rebuilds an engine table built on other credentials" */
    it("names each such table as drift and leaves the current ones and every view alone", () => {
      if (!rotated || !unstamped) throw new Error("the catalog maps too few PostgreSQL datasets");
      const comments = Object.fromEntries(relations.map((name) => [name, current]));
      comments[rotated] = stale;
      comments[unstamped] = "";

      expect(drift(relations, ["lwql_trace"], comments)).toEqual({
        objects: [rotated, unstamped],
        isKeyMapMissing: false,
      });
    });

    /** @scenario "The reconvergence check rebuilds an engine table built on other credentials" */
    it("reads a view's own comment as no drift", () => {
      const view = relations.at(-1);
      if (!view) throw new Error("the catalog declares no view");
      const comments = Object.fromEntries(relations.map((name) => [name, current]));
      comments[view] = "";

      expect(drift(relations, ["lwql_trace"], comments).objects).toEqual([]);
    });
  });
});

describe("given whether ClickHouse holds the app's collection values", () => {
  const relations = selfProvisioning.appOwnedRelations({ names: NAMES });
  const [engineTable] = relations.filter((name) => name.endsWith("_pg"));
  const fingerprint = selfProvisioning.credentialFingerprint({ names: NAMES, postgres: POSTGRES });
  const engineTablesOf = (statements: string[]) =>
    statements.filter((s) => s.includes("ENGINE = PostgreSQL"));
  const statementsWithCollection = ({
    collectionLoaded,
    mode,
    only,
  }: {
    collectionLoaded: boolean;
    mode: "sql" | "rendered";
    only?: readonly string[];
  }) =>
    selfProvisioning.clickHouseStatements({
      names: NAMES,
      restrictedPassword: "restricted-secret",
      sourceDatabase: SOURCE_DATABASE,
      postgres: POSTGRES,
      mode,
      collectionLoaded,
      ...(only === undefined ? {} : { only }),
    });

  describe("when a probe showed the collection holds them", () => {
    /** @scenario "The reconvergence check rebuilds an engine table built on other credentials" */
    it("stamps each engine table a deploy or a check replaces", () => {
      if (!engineTable) throw new Error("the catalog maps no PostgreSQL dataset");
      const deploy = engineTablesOf(
        statementsWithCollection({ collectionLoaded: true, mode: "rendered" }),
      );
      const check = engineTablesOf(
        statementsWithCollection({ collectionLoaded: true, mode: "rendered", only: [engineTable] }),
      );

      expect(deploy.length).toBeGreaterThan(0);
      for (const statement of [...deploy, ...check]) expect(statement).toContain(fingerprint);
      expect(check).toHaveLength(1);
      expect([...deploy, ...check].join("\n")).not.toContain(POSTGRES.readerPassword);
    });
  });

  describe("when no probe showed it", () => {
    /** @scenario "No engine table is rebuilt until ClickHouse holds the app's collection values" */
    it("replaces a rendered deploy's engine tables unstamped, so a later check rebuilds them", () => {
      const deploy = engineTablesOf(
        statementsWithCollection({ collectionLoaded: false, mode: "rendered" }),
      );

      expect(deploy.length).toBeGreaterThan(0);
      for (const statement of deploy) expect(statement).not.toContain("COMMENT");
    });

    /** @scenario "An engine table carries a fingerprint of the named collection's values, never the password" */
    it("orders a sql-mode deploy's collection first and leaves stamping to the task", () => {
      const statements = statementsWithCollection({ collectionLoaded: false, mode: "sql" });
      const collectionAt = statements.findIndex((s) => s.startsWith("CREATE NAMED COLLECTION"));
      const engineTableAt = statements.findIndex((s) => s.includes("ENGINE = PostgreSQL"));

      expect(collectionAt).toBeGreaterThanOrEqual(0);
      expect(engineTableAt).toBeGreaterThan(collectionAt);
      for (const statement of engineTablesOf(statements))
        expect(statement).not.toContain("COMMENT");
    });
  });
});

describe("given the drift a reconvergence check converges", () => {
  const statementsFor = (only: readonly string[]) =>
    selfProvisioning.clickHouseStatements({
      names: NAMES,
      restrictedPassword: "restricted-secret",
      sourceDatabase: SOURCE_DATABASE,
      postgres: POSTGRES,
      mode: "rendered",
      only,
    });
  const relations = selfProvisioning.appOwnedRelations({ names: NAMES });
  const engineTables = relations.filter((name) => name.endsWith("_pg"));

  /** @scenario "The reconvergence check converges the app-owned LangWatchQL objects it finds missing" */
  it("replaces only the drifted engine table and the views over it", () => {
    const [engineTable, other] = engineTables;
    if (!engineTable || !other) throw new Error("the catalog maps too few PostgreSQL datasets");

    const statements = statementsFor([engineTable]);
    const replaced = statements.filter((s) => s.includes("ENGINE = PostgreSQL"));
    const views = statements.filter((s) => s.startsWith("CREATE OR REPLACE VIEW"));

    expect(replaced).toHaveLength(1);
    expect(replaced[0]).toContain(`.${engineTable} (`);
    expect(views.length).toBeGreaterThan(0);
    for (const view of views) expect(view).toContain(`.${engineTable} AS`);
    expect(statements.some((s) => s.includes(`.${other}`))).toBe(false);
    expect(statements.some((s) => s.startsWith("CREATE OR REPLACE FUNCTION"))).toBe(false);
    expect(statements.some((s) => s.includes(NAMES.keyMapTable + " ("))).toBe(false);
    expect(statements.some((s) => /^CREATE DATABASE|^CREATE USER|^GRANT/.test(s))).toBe(false);
  });

  /** @scenario "The reconvergence check converges the app-owned LangWatchQL objects it finds missing" */
  it("creates the key map and a function only when each drifted, and a drifted view alone", () => {
    const view = relations.at(-1);
    const [appFunction] = lwqlAppFunctionNames();
    if (!view || !appFunction) throw new Error("the catalog declares no view or no function");

    expect(statementsFor([appFunction])).toEqual([
      expect.stringMatching(new RegExp(`^CREATE OR REPLACE FUNCTION ${appFunction} `)),
    ]);
    expect(statementsFor([NAMES.keyMapTable])).toEqual([
      expect.stringMatching(/^CREATE TABLE IF NOT EXISTS .*lwql_api_key_tenant_map /),
    ]);
    expect(statementsFor([view])).toEqual([
      expect.stringMatching(new RegExp(`^CREATE OR REPLACE VIEW ${SOURCE_DATABASE}\\.${view}\\n`)),
    ]);
  });
});

describe("given what the reconvergence check finds in PostgreSQL", () => {
  const views = selfProvisioning.approvedPostgresViews();
  const found = views.map((view) => ({ view, granted: true }));

  /** @scenario "The reconvergence check skips the PostgreSQL half when the reader role and approved views are in place" */
  it("finds no gap when every approved view exists and the reader may select it", () => {
    expect(selfProvisioning.findPostgresGaps({ found })).toEqual([]);
  });

  /** @scenario "The reconvergence check converges the app-owned LangWatchQL objects it finds missing" */
  it("names a missing view as absent and an ungranted one as present", () => {
    const [missing, ungranted] = views;
    if (!missing || !ungranted) throw new Error("the catalog maps too few datasets");
    const gapped = found
      .filter((view) => view.view !== missing)
      .map((view) => (view.view === ungranted ? { ...view, granted: false } : view));

    expect(selfProvisioning.findPostgresGaps({ found: gapped })).toEqual([
      { view: missing, absent: true },
      { view: ungranted, absent: false },
    ]);
  });
});
