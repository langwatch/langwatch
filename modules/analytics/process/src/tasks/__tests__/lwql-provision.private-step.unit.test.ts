/**
 * The task's private step: it runs after the shared converge, the project-keys copy is written on
 * every scoped converge, PostgreSQL is converged once however many private servers there are, and
 * a route variable that cannot be read never fails the upgrade.
 * @see specs/lwql/api.feature
 */
import type * as ClickHouseMigrations from "@langwatch/clickhouse-migrations";
import type * as Observability from "@langwatch/observability";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { LWQL_PROJECT_KEYS_VIEW } from "../../features/provisioning/rules/lwql-scoped-view.rules.ts";
import { LangWatchQLSelfProvisioningService } from "../../features/provisioning/services/langwatch-ql-self-provisioning.service.ts";
import { ClickHouseLangWatchQLProvisioningRepository } from "../../repositories/clickhouse/clickhouse.langwatch-ql-provisioning.repository.ts";
import type { LwqlProvisioningDatabase } from "../../repositories/langwatch-ql-postgres.repository.ts";
import {
  convergeLwqlAccessModel,
  convergeLwqlPrivateClickHouse,
  type LwqlConvergencePlan,
  LwqlProvisionTask,
} from "../lwql-provision.task.ts";

const { events, logCalls, routeConfig } = vi.hoisted(() => ({
  events: [] as string[],
  logCalls: [] as { level: string; fields: unknown; message: unknown }[],
  routeConfig: {
    endpoints: [] as { organizationId: string; url: string }[],
    malformed: false,
    sharedFails: false,
  },
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
vi.mock("@langwatch/clickhouse-migrations", async (importActual) => {
  const actual = await importActual<typeof ClickHouseMigrations>();
  return {
    ...actual,
    resolveClickHouseMigrationTaskConfig: () => {
      if (routeConfig.malformed) throw new TypeError("malformed route https://u:secret@x");
      return { privateEndpoints: routeConfig.endpoints };
    },
  };
});
vi.mock("../lwql-private-targets.task.ts", async (importActual) => ({
  ...(await importActual<object>()),
  provisionLwqlPrivateTargets: async ({ endpoints }: { endpoints: readonly unknown[] }) => {
    events.push(`private:${endpoints.length}`);
  },
}));

const SOURCE = {
  LWQL_ACCESS_MODEL_MODE: "rendered",
  LWQL_CLICKHOUSE_PASSWORD: "restricted-pw",
  LWQL_POSTGRES_READER_PASSWORD: "reader-pw",
  CLICKHOUSE_URL: "http://admin:secret@clickhouse:8123/langwatch",
  DATABASE_URL: "postgresql://app:app@postgres:5432/app",
};

/** A PostgreSQL that records each statement it runs and answers every read with no rows. */
function recordingDatabase() {
  const ran: string[] = [];
  const database: LwqlProvisioningDatabase = {
    $executeRawUnsafe: async (statement) => {
      ran.push(statement);
      return 0;
    },
    $queryRawUnsafe: async () => [],
    $transaction: (fn) => fn({ $executeRawUnsafe: async () => 0 }),
  };
  return { ran, database };
}

/** A shared ClickHouse that accepts every statement and holds nothing, as a fresh server does. */
function emptyServer() {
  return ClickHouseLangWatchQLProvisioningRepository.create({
    statements: {
      command: async () => undefined,
      rows: async (sql) =>
        sql.includes("postgresql(") ? [{ name: "TenantId", type: "String" }] : [],
      insert: async () => undefined,
    },
  });
}

beforeEach(() => {
  events.length = 0;
  logCalls.length = 0;
  routeConfig.endpoints = [];
  routeConfig.malformed = false;
  routeConfig.sharedFails = false;
  vi.spyOn(ClickHouseLangWatchQLProvisioningRepository, "open").mockImplementation(() => {
    events.push("shared-clickhouse");
    if (routeConfig.sharedFails) throw new Error("the shared ClickHouse is not reachable");
    return emptyServer();
  });
});

const projectKeysStatements = (ran: readonly string[]) =>
  ran.filter((statement) => statement.includes(`"lwql_scoped"."${LWQL_PROJECT_KEYS_VIEW}"`));

describe("given two organisations on private ClickHouse servers", () => {
  /** @scenario "A private ClickHouse is provisioned after the shared one, and PostgreSQL runs once" */
  it("converges the shared server first, then runs the private step with both routes", async () => {
    routeConfig.endpoints = [
      { organizationId: "org-a", url: "https://a.invalid/a_db" },
      { organizationId: "org-b", url: "https://b.invalid/b_db" },
    ];
    const { database } = recordingDatabase();

    await LwqlProvisionTask.create({ database: () => database, source: SOURCE }).run({
      args: [],
      signal: new AbortController().signal,
    });

    expect(events[0]).toBe("shared-clickhouse");
    expect(events.at(-1)).toBe("private:2");
  });

  /** @scenario "Private provisioning waits for the shared converge and is skipped when it fails" */
  it("skips the private step with one warning when the shared converge did not complete", async () => {
    routeConfig.sharedFails = true;
    routeConfig.endpoints = [{ organizationId: "org-a", url: "https://a.invalid/a_db" }];
    const { database } = recordingDatabase();

    await LwqlProvisionTask.create({ database: () => database, source: SOURCE }).run({
      args: [],
      signal: new AbortController().signal,
    });

    expect(events.some((event) => event.startsWith("private"))).toBe(false);
    expect(
      logCalls.filter(
        (call) => call.level === "warn" && String(call.message).includes("shared converge"),
      ),
    ).toHaveLength(1);
  });
});

describe("given a private server's ClickHouse converge", () => {
  /** @scenario "A private ClickHouse is provisioned after the shared one, and PostgreSQL runs once" */
  it("runs no PostgreSQL statement, so PostgreSQL is converged once per run, not per server", async () => {
    const { ran, database } = recordingDatabase();
    const repository = {
      readCollectionState: async () => ({ available: ["lwql_postgres"], bound: {} }),
      inventoryConfigStore: async () => [],
      queryRows: async () => [],
      runStatements: async () => ({ skipped: [] }),
      close: async () => undefined,
    };

    await convergeLwqlPrivateClickHouse({
      database,
      plan: { ...planFor(), openRepository: () => repository as never },
    });

    expect(ran).toEqual([]);
  });
});

describe("given a route variable that cannot be read", () => {
  /** @scenario "A malformed private route variable warns and never fails the upgrade" */
  it("warns without the route text, finds no private server and still resolves", async () => {
    routeConfig.malformed = true;
    const { database } = recordingDatabase();

    await expect(
      LwqlProvisionTask.create({ database: () => database, source: SOURCE }).run({
        args: [],
        signal: new AbortController().signal,
      }),
    ).resolves.toBeUndefined();

    expect(events.at(-1)).toBe("private:0");
    expect(
      logCalls.some(
        (call) => call.level === "warn" && String(call.message).includes("could not be read"),
      ),
    ).toBe(true);
    expect(JSON.stringify(logCalls)).not.toContain("secret@x");
  });
});

function planFor(): LwqlConvergencePlan {
  const request = LangWatchQLSelfProvisioningService.create().request({
    source: {
      ...SOURCE,
      CLICKHOUSE_URL: "http://admin:secret@clickhouse:8123/langwatch",
    },
  });
  if (!request.requested || !request.complete) throw new Error("the source is complete");
  return {
    request,
    names: {
      database: "langwatch",
      restrictedUser: "langwatch_lwql",
      settingsProfile: "lwql_restricted",
      keyMapTable: "lwql_api_key_tenant_map",
      tenantSetting: "custom_api_key_hash",
    },
    sourceDatabase: () => "langwatch",
    schema: "public",
    settings: {},
    openRepository: () => {
      throw new Error("no ClickHouse in this test");
    },
  };
}

describe("given the scoped converge of either kind", () => {
  /** @scenario "The project-keys copy is written and granted on every scoped converge" */
  it("writes the project-keys copy on a full converge", async () => {
    const { ran, database } = recordingDatabase();

    await convergeLwqlAccessModel({ database, plan: planFor() });

    expect(projectKeysStatements(ran).some((s) => s.includes("CREATE OR REPLACE VIEW"))).toBe(true);
    expect(projectKeysStatements(ran).some((s) => s.includes("GRANT SELECT"))).toBe(true);
  });

  /** @scenario "The project-keys copy is written and granted on every scoped converge" */
  it("writes it on a drift repair only when it is a gap, after the group's grants", async () => {
    const { ran, database } = recordingDatabase();
    const [view = ""] = LangWatchQLSelfProvisioningService.create().approvedPostgresViews();

    await convergeLwqlAccessModel({
      database,
      plan: planFor(),
      only: {
        clickHouse: [],
        postgres: [{ kind: "scoped", view, repair: "absent" }],
        isKeyMapMissing: false,
      },
    });

    expect(projectKeysStatements(ran)).toEqual([]);

    const gapped = recordingDatabase();
    await convergeLwqlAccessModel({
      database: gapped.database,
      plan: planFor(),
      only: {
        clickHouse: [],
        postgres: [{ kind: "scoped", view: LWQL_PROJECT_KEYS_VIEW, repair: "absent" }],
        isKeyMapMissing: false,
      },
    });
    const created = gapped.ran.findIndex((s) => s.includes(`"${LWQL_PROJECT_KEYS_VIEW}"`));
    const granted = gapped.ran.findIndex((s) => s.includes('GRANT USAGE ON SCHEMA "lwql_scoped"'));
    expect(created).toBeGreaterThan(granted);
  });
});
