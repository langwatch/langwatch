/**
 * Provisioning LangWatchQL on each organisation's own ClickHouse: the real plan and statement
 * builders over a recorded converge and a stubbed repository.
 * @see specs/lwql/api.feature
 */
import { createHash } from "node:crypto";

import type * as Observability from "@langwatch/observability";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  LangWatchQLSelfProvisioningService,
  LwqlPrivateCollectionAbsentError,
} from "../../features/provisioning/services/langwatch-ql-self-provisioning.service.ts";
import { privateReaderOf } from "../../rules/lwql-private-reader.rules.ts";
import { provisionLwqlPrivateTargets } from "../lwql-private-targets.task.ts";
import { convergeLwqlPrivateRepository, type LwqlConvergencePlan } from "../lwql-provision.task.ts";

const { logCalls, policyRows, policyChecks, readerByUrl } = vi.hoisted(() => ({
  logCalls: [] as { level: string; fields: unknown; message: unknown }[],
  /** 1: each table has the reader's own policy; 0: the first has none; 2: only another reader's. */
  policyRows: { n: 1 },
  policyChecks: [] as { url: string; tables: readonly string[] }[],
  readerByUrl: new Map<string, string>(),
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
    open: ({ url }: { url: string }) => ({
      findRowPolicies: async ({ tables }: { tables: readonly string[] }) => {
        policyChecks.push({ url, tables });
        const reader = policyRows.n === 2 ? "langwatch_lwql_other" : (readerByUrl.get(url) ?? "");
        return (policyRows.n === 0 ? tables.slice(1) : tables).map((table) => ({
          table,
          appliesTo: [reader],
          appliesToAll: false,
          hasExceptions: false,
        }));
      },
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
  shared = SHARED_PLAN,
}: {
  endpoints: { organizationId?: string; url: string }[];
  keyPepper?: string | null;
  converge?: (plan: LwqlConvergencePlan) => Promise<void>;
  shared?: LwqlConvergencePlan;
}) {
  for (const { organizationId, url } of endpoints) {
    if (organizationId) {
      readerByUrl.set(url, privateReaderOf({ keyPepper: PEPPER, organizationId }).username);
    }
  }
  const converged = vi.fn(converge);
  return {
    converged,
    done: provisionLwqlPrivateTargets({
      endpoints,
      sharedUrl: SHARED_URL,
      keyPepper: keyPepper ?? undefined,
      shared,
      converge: converged,
    }),
  };
}

beforeEach(() => {
  logCalls.length = 0;
  policyChecks.length = 0;
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

describe("given two organisations whose routes name one server and database", () => {
  /** @scenario "A second organization on a private database claimed in the same run is refused and warned" */
  it("converges it once for the first organisation in id order and warns for the other", async () => {
    const { converged, done } = run({
      endpoints: [
        { organizationId: "org-b", url: "https://other-admin:pw@ACME.invalid:8443/acme_db?x=1" },
        { organizationId: "org-a", url: ADMIN_URL },
      ],
    });
    await done;

    expect(converged).toHaveBeenCalledTimes(1);
    const [plan] = converged.mock.calls[0] ?? [];
    expect(plan?.names.database).toBe("acme_db");
    expect(plan?.names.restrictedUser).toBe(
      privateReaderOf({ keyPepper: PEPPER, organizationId: "org-a" }).username,
    );
    const warning = logCalls.find((call) => call.level === "warn");
    expect(warning?.fields).toMatchObject({ organizationId: "org-b", owner: "org-a" });
    expect(JSON.stringify(logCalls)).not.toContain("other-admin");
  });

  /** @scenario "A second organization on a private database claimed in the same run is refused and warned" */
  it("converges one organisation's route listed twice once, with no warning", async () => {
    const { converged, done } = run({
      endpoints: [
        { organizationId: "org-a", url: ADMIN_URL },
        { organizationId: "org-a", url: ADMIN_URL },
      ],
    });
    await done;

    expect(converged).toHaveBeenCalledTimes(1);
    expect(logCalls.filter((call) => call.level === "warn")).toEqual([]);
  });
});

describe("given a private route naming the shared server's own database", () => {
  /** @scenario "A private route naming a shared server's origin is refused and warned" */
  it("refuses it however the URL is spelt, converges nothing and warns naming the organisation", async () => {
    const { converged, done } = run({
      endpoints: [
        { organizationId: "org-shared", url: "HTTP://admin:pw@SHARED.invalid:8123/langwatch?x=1" },
      ],
    });
    await done;

    expect(converged).not.toHaveBeenCalled();
    expect(logCalls.find((call) => call.level === "warn")?.fields).toMatchObject({
      organizationId: "org-shared",
    });
  });

  /** @scenario "A private route naming a shared server's origin is refused and warned" */
  it("refuses another database on the shared server's origin too", async () => {
    const { converged, done } = run({
      endpoints: [
        { organizationId: "org-a", url: "http://admin:pw@shared.invalid:8123/analytics" },
      ],
    });
    await done;

    expect(converged).not.toHaveBeenCalled();
    expect(logCalls.find((call) => call.level === "warn")?.fields).toMatchObject({
      organizationId: "org-a",
    });
  });

  /** @scenario "A private route naming a shared server's origin is refused and warned" */
  it("refuses a route on the LangWatchQL connection's origin when that is set apart", async () => {
    const apart: LwqlConvergencePlan = {
      ...SHARED_PLAN,
      request: {
        ...SHARED_PLAN.request,
        connection: { ...SHARED_PLAN.request.connection, url: "http://lwql.invalid:8123" },
      },
    };
    const { converged, done } = run({
      endpoints: [{ organizationId: "org-a", url: "http://admin:pw@LWQL.invalid:8123/analytics" }],
      shared: apart,
    });
    await done;

    expect(converged).not.toHaveBeenCalled();
  });
});

describe("given a route whose database name is not a plain identifier", () => {
  /** @scenario "A private route naming a shared server's origin is refused and warned" */
  it("refuses it before any statement or query, and warns without the URL", async () => {
    const { converged, done } = run({
      endpoints: [{ organizationId: "org-a", url: "https://admin:pw@acme.invalid/acme'db" }],
    });
    await done;

    expect(converged).not.toHaveBeenCalled();
    expect(policyChecks).toEqual([]);
    expect(JSON.stringify(logCalls)).not.toContain("acme.invalid");
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
  /** @scenario "A private ClickHouse with a source table not policed for the reader after provisioning warns" */
  it("checks the reader's policies on the source tables, warning only when one is unguarded", async () => {
    policyRows.n = 0;
    await run({ endpoints: [{ organizationId: "org-acme", url: ADMIN_URL }] }).done;
    expect(logCalls.filter((call) => call.level === "warn")).toHaveLength(1);

    const [check] = policyChecks;
    expect(check?.tables).toContain("acme_db.trace_summaries");
    expect(check?.tables).toContain("acme_db.lwql_project_keys");

    logCalls.length = 0;
    policyRows.n = 2;
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
  it("warns once, naming the organisation and the missing collection, and still resolves", async () => {
    const { done } = run({
      endpoints: [{ organizationId: "org-acme", url: ADMIN_URL }],
      converge: async () => {
        throw new LwqlPrivateCollectionAbsentError({ collection: "lwql_postgres" });
      },
    });
    await done;

    const warnings = logCalls.filter((call) => call.level === "warn");
    expect(warnings).toHaveLength(1);
    expect(warnings[0]?.fields).toMatchObject({ organizationId: "org-acme" });
    expect(String(warnings[0]?.message)).toContain("lwql_postgres");
  });

  /** @scenario "A private ClickHouse without lwql_postgres is left unprovisioned and warns" */
  it("runs no statement and raises the named error, leaving the one warning to the caller", async () => {
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
    expect(logCalls.filter((call) => call.level === "warn")).toEqual([]);
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
  it("polices every source table and the key map for the reader alone, each tenant policy reading the engine table", () => {
    const policies = statementsFor({ privateServer: true }).filter((statement) =>
      statement.startsWith("CREATE ROW POLICY"),
    );
    const guarded = policies.map((policy) => /ON (\S+)/.exec(policy)?.[1]);
    const expected = [
      ...LangWatchQLSelfProvisioningService.create().policedTables({
        names: PRIVATE_NAMES,
        sourceDatabase: "acme_db",
      }),
      "acme_db.lwql_project_keys",
    ];

    const byName = (a: string | undefined, b: string | undefined) =>
      (a ?? "").localeCompare(b ?? "");
    expect([...new Set(guarded)].toSorted(byName)).toEqual([...new Set(expected)].toSorted(byName));
    expect(new Set(guarded).size).toBe(guarded.length);
    for (const policy of policies) {
      expect(policy).toMatch(new RegExp(`TO ${PRIVATE_NAMES.restrictedUser}$`));
      expect(policy).not.toMatch(/USING\s+(1|true)\b/i);
    }
    const tenantPolicies = policies.filter((statement) => statement.includes("IN (SELECT any("));
    expect(tenantPolicies.length).toBeGreaterThan(0);
    for (const policy of tenantPolicies) expect(policy).toContain("FROM acme_db.lwql_project_keys");
  });

  /** @scenario "No provisioning statement sent to a private ClickHouse carries a capability" */
  it("sends no insert and no capability value, only the reader's own password hash", () => {
    const sent = statementsFor({ privateServer: true });
    const readerHash = createHash("sha256").update("reader-password").digest("hex");

    expect(sent.filter((statement) => /^INSERT/i.test(statement))).toEqual([]);
    const hashes = sent.flatMap(
      (statement) => statement.match(/(?<![0-9a-f])[0-9a-f]{64}(?![0-9a-f])/gi) ?? [],
    );
    expect(hashes).toEqual([readerHash]);
    const createUser = sent.find((statement) => statement.startsWith("CREATE USER")) ?? "";
    expect(createUser).toContain(`'${readerHash}'`);
    expect(sent.filter((statement) => /custom_lwql_key_hash\s*=\s*'[^']/.test(statement))).toEqual(
      [],
    );
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
