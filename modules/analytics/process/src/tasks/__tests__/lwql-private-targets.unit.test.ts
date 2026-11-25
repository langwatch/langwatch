/**
 * Provisioning LangWatchQL on each organisation's own ClickHouse: the real plan and statement
 * builders over a recorded converge and a stubbed repository.
 * @see specs/lwql/api.feature
 */
import type * as Observability from "@langwatch/observability";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { LangWatchQLSelfProvisioningService } from "../../features/provisioning/services/langwatch-ql-self-provisioning.service.ts";
import { privateReaderOf } from "../../rules/lwql-private-reader.rules.ts";
import { provisionLwqlPrivateTargets } from "../lwql-private-targets.task.ts";
import { convergeLwqlPrivateRepository, type LwqlConvergencePlan } from "../lwql-provision.task.ts";

const { logCalls, policyRows } = vi.hoisted(() => ({
  logCalls: [] as { level: string; fields: unknown; message: unknown }[],
  policyRows: { n: 1 },
}));
vi.mock("@langwatch/observability", async (importActual) => {
  const actual = await importActual<typeof Observability>();
  const at =
    (level: string) =>
    (...args: unknown[]) => {
      logCalls.push({ level, fields: args.length > 1 ? args[0] : undefined, message: args.at(-1) });
    };
  return {
    ...actual,
    createLogger: () => ({
      info: at("info"),
      warn: at("warn"),
      error: at("error"),
      debug: at("debug"),
    }),
  };
});
vi.mock("../../repositories/clickhouse/clickhouse.langwatch-ql-provisioning.repository.ts", () => ({
  ClickHouseLangWatchQLProvisioningRepository: {
    open: () => ({
      queryRows: async () => [{ n: String(policyRows.n) }],
      close: async () => undefined,
    }),
  },
}));

const PEPPER = "test-pepper";
const ADMIN_URL = "https://route-admin:route-admin-pw@acme.invalid:8443/acme_db";
const OTHER_URL = "https://other-admin:other-admin-pw@other.invalid:8443/other_db";
const SHARED_URL = "http://default:shared-pw@shared.invalid:8123/langwatch";
const POSTGRES = { endpoint: { host: "postgres", port: 5432, database: "langwatch" } };

const SHARED_PLAN: LwqlConvergencePlan = {
  request: {
    requested: true,
    complete: true,
    connection: {
      url: "http://shared.invalid:8123",
      username: "langwatch_lwql",
      password: "shared-lwql-password",
      database: "langwatch",
      tenantSetting: "custom_lwql_key_hash",
    },
    postgresReaderPassword: "pg-reader-password",
    ...POSTGRES,
  },
  names: {
    database: "langwatch",
    restrictedUser: "langwatch_lwql",
    settingsProfile: "langwatch_profile",
    keyMapTable: "lwql_api_key_tenant_map",
    tenantSetting: "custom_lwql_key_hash",
  },
  sourceDatabase: () => "langwatch",
  schema: "public",
  settings: {},
  openRepository: () => {
    throw new Error("the shared repository is never opened by a private target");
  },
};

function run({
  endpoints,
  keyPepper = PEPPER,
  converge = async () => undefined,
}: {
  endpoints: { organizationId?: string; url: string }[];
  keyPepper?: string | null;
  converge?: (plan: LwqlConvergencePlan) => Promise<void>;
}) {
  const converged = vi.fn(converge);
  return {
    converged,
    done: provisionLwqlPrivateTargets({
      endpoints,
      sharedUrl: SHARED_URL,
      keyPepper: keyPepper ?? undefined,
      shared: SHARED_PLAN,
      clusterName: undefined,
      converge: converged,
    }),
  };
}

beforeEach(() => {
  logCalls.length = 0;
  policyRows.n = 1;
});

describe("given a private ClickHouse route for each of two organisations", () => {
  /** @scenario "Each private ClickHouse is provisioned with its own derived reader" */
  it("converges each server in its own database as that organisation's reader, on the router's tenant setting", async () => {
    const { converged, done } = run({
      endpoints: [
        { organizationId: "org-acme", url: ADMIN_URL },
        { organizationId: "org-other", url: OTHER_URL },
      ],
    });
    await done;

    const plans = converged.mock.calls.map(([plan]) => plan);
    expect(plans.map((plan) => plan.names.database)).toEqual(["acme_db", "other_db"]);
    expect(plans.map((plan) => plan.names.restrictedUser)).toEqual([
      privateReaderOf({ keyPepper: PEPPER, organizationId: "org-acme" }).username,
      privateReaderOf({ keyPepper: PEPPER, organizationId: "org-other" }).username,
    ]);
    expect(plans[0]?.names.tenantSetting).toBe("custom_lwql_key_hash");
    expect(plans[0]?.sourceDatabase()).toBe("acme_db");
  });
});

describe("given a private ClickHouse whose admin user the route URL carries", () => {
  /** @scenario "Provisioning never creates, replaces or alters the route URL's own user" */
  it("writes statements for the derived reader only, never the admin's name or password", async () => {
    const { converged, done } = run({
      endpoints: [{ organizationId: "org-acme", url: ADMIN_URL }],
    });
    await done;

    const [plan] = converged.mock.calls[0] ?? [];
    if (plan?.request.complete !== true) throw new Error("the plan carries a complete request");
    const statements = LangWatchQLSelfProvisioningService.create().clickHouseStatements({
      names: plan.names,
      restrictedPassword: plan.request.connection.password,
      sourceDatabase: plan.sourceDatabase(),
      postgres: { endpoint: plan.request.endpoint, readerPassword: "" },
      schema: plan.schema,
      externalCollection: "lwql_postgres",
      postgresKeyMap: true,
    });
    const users = statements.filter((statement) => /^(CREATE|ALTER) USER/.test(statement));

    expect(users).toHaveLength(1);
    expect(users[0]).toContain(plan.names.restrictedUser);
    const all = statements.join("\n");
    expect(all).not.toContain("route-admin");
    expect(all).not.toContain("route-admin-pw");
    expect(all).not.toContain("shared-lwql-password");
  });
});

describe("given two route variables naming one ClickHouse", () => {
  /** @scenario "A private ClickHouse routed twice is provisioned once" */
  it("converges that server once, and never the shared one", async () => {
    const { converged, done } = run({
      endpoints: [
        { organizationId: "org-acme", url: ADMIN_URL },
        { organizationId: "org-acme-again", url: ADMIN_URL },
        { organizationId: "org-shared", url: SHARED_URL },
      ],
    });
    await done;

    expect(converged).toHaveBeenCalledTimes(1);
  });
});

describe("given a private ClickHouse whose admin lacks a grant", () => {
  /** @scenario "A private ClickHouse that cannot be provisioned warns and leaves the rest running" */
  it("warns without the URL or passwords, still converges the others, and does not throw", async () => {
    const refusal = Object.assign(
      new Error(`Not enough privileges at ${ADMIN_URL} (route-admin-pw)`),
      { code: "497", type: "ACCESS_DENIED" },
    );
    const { converged, done } = run({
      endpoints: [
        { organizationId: "org-acme", url: ADMIN_URL },
        { organizationId: "org-other", url: OTHER_URL },
      ],
      converge: async (plan) => {
        if (plan.names.database === "acme_db") throw refusal;
      },
    });

    await expect(done).resolves.toBeUndefined();

    expect(converged).toHaveBeenCalledTimes(2);
    const warning = logCalls.find((call) => call.level === "warn");
    expect(warning?.fields).toMatchObject({ organizationId: "org-acme" });
    const logged = JSON.stringify(logCalls);
    expect(logged).not.toContain("route-admin-pw");
    expect(logged).not.toContain("acme.invalid");
  });
});

describe("given a private route and no key pepper", () => {
  /** @scenario "Private provisioning is skipped without a key pepper" */
  it("touches no private server and says why", async () => {
    const { converged, done } = run({
      endpoints: [{ organizationId: "org-acme", url: ADMIN_URL }],
      keyPepper: null,
    });
    await done;

    expect(converged).not.toHaveBeenCalled();
    expect(logCalls.some((call) => call.level === "warn")).toBe(true);
  });
});

describe("given a private ClickHouse provisioned without error", () => {
  /** @scenario "A private ClickHouse with no row policy on traces after provisioning warns" */
  it("warns when no row policy on traces applies to the reader, and stays quiet when one does", async () => {
    policyRows.n = 0;
    await run({ endpoints: [{ organizationId: "org-acme", url: ADMIN_URL }] }).done;
    expect(logCalls.filter((call) => call.level === "warn")).toHaveLength(1);

    logCalls.length = 0;
    policyRows.n = 1;
    await run({ endpoints: [{ organizationId: "org-acme", url: ADMIN_URL }] }).done;
    expect(logCalls.filter((call) => call.level === "warn")).toHaveLength(0);
  });
});

/** A private repository holding what `available` says, recording the statements it is given. */
function repositoryHolding({ available }: { available: string[] }) {
  const statements: string[] = [];
  const repository = {
    readCollectionState: async () => ({ available, bound: {} }),
    inventoryConfigStore: async () => [],
    queryRows: async () => [],
    runStatements: async (input: { statements: readonly string[] }) => {
      statements.push(...input.statements);
      return { skipped: [] };
    },
    close: async () => undefined,
  };
  return { repository: repository as never, statements };
}

describe("given a private ClickHouse that mounts its own lwql_postgres collection", () => {
  /** @scenario "A private ClickHouse binds its views to its own lwql_postgres and never carries the shared Postgres password" */
  it("binds the engine tables to it, and writes no collection and no shared Postgres password", async () => {
    const { repository, statements } = repositoryHolding({ available: ["lwql_postgres"] });
    const plan = {
      ...SHARED_PLAN,
      names: { ...SHARED_PLAN.names, database: "acme_db" },
      sourceDatabase: () => "acme_db",
    };

    await convergeLwqlPrivateRepository({ repository, plan });

    const all = statements.join("\n");
    expect(statements.length).toBeGreaterThan(0);
    expect(all).toContain("lwql_postgres");
    expect(all).not.toMatch(/NAMED COLLECTION/);
    expect(all).not.toContain("pg-reader-password");
  });
});

describe("given a private ClickHouse without a lwql_postgres collection", () => {
  /** @scenario "A private ClickHouse without lwql_postgres is left unprovisioned and warns" */
  it("runs no statement and warns, so the organisation stays refused", async () => {
    const { repository, statements } = repositoryHolding({ available: [] });
    const plan = {
      ...SHARED_PLAN,
      names: { ...SHARED_PLAN.names, database: "acme_db" },
      sourceDatabase: () => "acme_db",
    };

    await expect(convergeLwqlPrivateRepository({ repository, plan })).rejects.toThrow(
      "named collection absent",
    );

    expect(statements).toEqual([]);
    expect(logCalls.some((call) => call.level === "warn")).toBe(true);
  });
});

const PRIVATE_NAMES = {
  database: "acme_db",
  restrictedUser: "langwatch_lwql_0123456789ab",
  settingsProfile: "langwatch_lwql_0123456789ab_profile",
  keyMapTable: "lwql_project_keys",
  tenantSetting: "custom_lwql_key_hash",
};

function statementsFor({ privateServer }: { privateServer: boolean }): string[] {
  return LangWatchQLSelfProvisioningService.create().clickHouseStatements({
    names: privateServer ? PRIVATE_NAMES : SHARED_PLAN.names,
    restrictedPassword: "reader-password",
    sourceDatabase: privateServer ? "acme_db" : "langwatch",
    postgres: { endpoint: SHARED_PLAN.request.endpoint, readerPassword: "" },
    schema: privateServer ? "lwql_scoped" : "public",
    ...(privateServer ? { externalCollection: "lwql_postgres", postgresKeyMap: true } : {}),
  });
}

describe("given the plan for a private ClickHouse", () => {
  /** @scenario "A private ClickHouse reads its key map from Postgres through lwql_postgres" */
  it("makes the key map a PostgreSQL-engine table over the scoped project keys", () => {
    const all = statementsFor({ privateServer: true }).join("\n");

    expect(all).toContain(
      "CREATE OR REPLACE TABLE acme_db.lwql_project_keys (KeyHash String, TenantId String) " +
        "ENGINE = PostgreSQL(lwql_postgres, table='lwql_project_keys', schema='lwql_scoped')",
    );
    expect(all).not.toContain("lwql_api_key_tenant_map");
    expect(all).not.toMatch(/MergeTree/);
  });

  /** @scenario "A private ClickHouse reads its key map from Postgres through lwql_postgres" */
  it("points every row policy at that engine table", () => {
    const policies = statementsFor({ privateServer: true }).filter((statement) =>
      statement.startsWith("CREATE ROW POLICY"),
    );
    const tenantPolicies = policies.filter((statement) => statement.includes("IN (SELECT any("));

    expect(tenantPolicies.length).toBeGreaterThan(0);
    for (const policy of tenantPolicies) expect(policy).toContain("FROM acme_db.lwql_project_keys");
  });

  /** @scenario "No statement sent to a private ClickHouse carries a capability" */
  it("sends no insert and no capability value, only the reader's own password hash", () => {
    const sent = statementsFor({ privateServer: true });

    expect(sent.filter((statement) => /^INSERT/i.test(statement))).toEqual([]);
    const others = sent.filter((statement) => !statement.startsWith("CREATE USER"));
    expect(others.filter((statement) => /\b[0-9a-f]{64}\b/.test(statement))).toEqual([]);
    expect(
      others.filter((statement) => /custom_lwql_key_hash\s*=\s*'[^']/.test(statement)),
    ).toEqual([]);
  });
});

describe("given the plan for the shared ClickHouse", () => {
  /** @scenario "The shared ClickHouse keeps its local key-map table" */
  it("still creates the local MergeTree key map and reads it, with no project-keys table", () => {
    const all = statementsFor({ privateServer: false }).join("\n");

    expect(all).toContain("CREATE TABLE IF NOT EXISTS langwatch.lwql_api_key_tenant_map");
    expect(all).toContain("FROM langwatch.lwql_api_key_tenant_map");
    expect(all).not.toContain("lwql_project_keys");
  });
});
