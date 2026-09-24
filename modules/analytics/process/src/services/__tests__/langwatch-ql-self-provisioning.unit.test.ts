import { describe, expect, it } from "vitest";

import { canProvisionAppFunctions } from "../../rules/langwatch-ql-app-function-store.rules.ts";
import type { LangWatchQLNames } from "../langwatch-ql-access-model.service.ts";
import { LangWatchQLSelfProvisioningService } from "../langwatch-ql-self-provisioning.service.ts";

const selfProvisioning = LangWatchQLSelfProvisioningService.create();

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
