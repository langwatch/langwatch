import type * as Observability from "@langwatch/observability";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { lwqlAppFunctionNames } from "../../features/app-functions/rules/langwatch-ql-app-function-catalog.rules.ts";
import {
  LangWatchQLProductionProvisioningService,
  LWQL_POSTGRES_READER_ROLE,
} from "../../features/provisioning/services/langwatch-ql-production-provisioning.service.ts";
import {
  type LwqlAppOwnedDrift,
  LangWatchQLSelfProvisioningService,
} from "../../features/provisioning/services/langwatch-ql-self-provisioning.service.ts";
import { ClickHouseLangWatchQLProvisioningRepository } from "../../repositories/clickhouse/clickhouse.langwatch-ql-provisioning.repository.ts";
import type { LwqlProvisioningDatabase } from "../../repositories/langwatch-ql-postgres.repository.ts";
import { LWQL_VIEW_CATALOG } from "../../rules/lwql-view-catalog.rules.ts";
import {
  APP_FUNCTION_SPLIT_CODE,
  convergeLwqlAccessModel,
  findLwqlAppOwnedDrift,
  type LwqlConvergencePlan,
  LwqlProvisionTask,
  verifyAppFunctionsOnEveryReplica,
} from "../lwql-provision.task.ts";

const { logCalls } = vi.hoisted(() => ({
  logCalls: [] as { level: string; fields: unknown; message: unknown }[],
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

const selfProvisioning = LangWatchQLSelfProvisioningService.create();
const READER_PASSWORD = "reader-unit-secret";
const NAMES = {
  database: "langwatch",
  restrictedUser: "langwatch_lwql",
  settingsProfile: "lwql_restricted",
  keyMapTable: "api_key_tenants",
  tenantSetting: "custom_api_key_hash",
};

/** A PostgreSQL that records each statement, or refuses each as one without CREATEROLE does. */
function postgresThat({ refuses }: { refuses: boolean }) {
  const ran: string[] = [];
  const database: LwqlProvisioningDatabase = {
    $executeRawUnsafe: async (statement) => {
      if (refuses) {
        throw Object.assign(
          new Error("Raw query failed. Code: `42501`. Message: `permission denied`"),
          {
            code: "P2010",
            meta: { code: "42501" },
          },
        );
      }
      ran.push(statement);
      return 0;
    },
    $queryRawUnsafe: async () => [],
    $transaction: (fn) => fn({ $executeRawUnsafe: async () => 0 }),
  };
  return { ran, database };
}

/** A ClickHouse that records each DDL statement and fails the one that matches `failing`. */
function clickHouseThat({ failing }: { failing?: RegExp } = {}) {
  const ran: string[] = [];
  const plan: LwqlConvergencePlan = {
    request: {
      requested: true,
      complete: true,
      connection: {
        url: "http://127.0.0.1:8123",
        username: NAMES.restrictedUser,
        password: "restricted-unit-secret",
        database: NAMES.database,
        tenantSetting: NAMES.tenantSetting,
      },
      postgresReaderPassword: READER_PASSWORD,
      endpoint: { host: "postgres", port: 5432, database: "langwatch" },
    },
    names: NAMES,
    sourceDatabase: () => NAMES.database,
    schema: "public",
    settings: { LWQL_ACCESS_MODEL_MODE: "rendered" },
    openRepository: () =>
      ClickHouseLangWatchQLProvisioningRepository.create({
        statements: {
          async command(statement) {
            if (failing?.test(statement)) {
              throw Object.assign(new Error("Code: 669. DB::Exception: no named collection"), {
                code: "669",
                type: "NAMED_COLLECTION_DOESNT_EXIST",
              });
            }
            ran.push(statement);
          },
          rows: async () => [],
          insert: async () => undefined,
        },
      }),
  };
  return { ran, plan };
}

beforeEach(() => {
  logCalls.length = 0;
});

function untouchedDatabase(): LwqlProvisioningDatabase {
  return { $executeRawUnsafe: vi.fn(), $queryRawUnsafe: vi.fn(), $transaction: vi.fn() };
}

describe("LwqlProvisionTask", () => {
  describe("given no LWQL_* environment is configured", () => {
    /** @scenario "A task runs by name with its arguments" */
    it("is named lwql-provision and skips without touching the database", async () => {
      const database = untouchedDatabase();
      const task = LwqlProvisionTask.create({ database: () => database, source: {} });
      expect(task.name).toBe("lwql-provision");

      const controller = new AbortController();
      await task.run({ args: [], signal: controller.signal });

      expect(database.$executeRawUnsafe).not.toHaveBeenCalled();
    });
  });

  describe("when the deploy sets SKIP_LWQL_PROVISION", () => {
    /** @scenario "The operator opt-out skips LangWatchQL provisioning in the boot chain" */
    it("provisions nothing and reads no project rows", async () => {
      const database = untouchedDatabase();
      const task = LwqlProvisionTask.create({
        database: () => database,
        source: {},
        skipped: true,
      });

      await task.run({ args: [], signal: new AbortController().signal });

      expect(database.$executeRawUnsafe).not.toHaveBeenCalled();
    });
  });

  describe("when the restricted password is set but the reader password never arrived", () => {
    it("declines this boot without touching either database", async () => {
      const database = untouchedDatabase();
      const task = LwqlProvisionTask.create({
        database: () => database,
        source: {
          CLICKHOUSE_URL: "http://admin:secret@clickhouse:8123/langwatch",
          LWQL_CLICKHOUSE_PASSWORD: "restricted",
          DATABASE_URL: "postgresql://app:secret@postgres/langwatch",
        },
      });

      await task.run({ args: [], signal: new AbortController().signal });

      expect(database.$transaction).not.toHaveBeenCalled();
      expect(database.$executeRawUnsafe).not.toHaveBeenCalled();
    });
  });

  describe("when CLICKHOUSE_URL parses but names an invalid database identifier", () => {
    /** @scenario "An unparsable ClickHouse database name does not crash boot" */
    it("returns without throwing instead of crashing the deploy task", async () => {
      const database = untouchedDatabase();
      const task = LwqlProvisionTask.create({
        database: () => database,
        source: {
          LWQL_CLICKHOUSE_PASSWORD: "restricted-pw",
          LWQL_POSTGRES_READER_PASSWORD: "reader-pw",
          CLICKHOUSE_URL: "http://clickhouse:8123/bad-db!",
          DATABASE_URL: "postgresql://app:app@postgres:5432/app",
        },
      });

      await expect(
        task.run({ args: [], signal: new AbortController().signal }),
      ).resolves.toBeUndefined();
      expect(database.$transaction).not.toHaveBeenCalled();
    });
  });

  describe("when the upgrade's reconciler runs it and the provisioning fails", () => {
    /** @scenario "A LangWatchQL provisioning failure fails the upgrade run" */
    it("rejects instead of logging and continuing", async () => {
      const task = LwqlProvisionTask.create({
        database: () => untouchedDatabase(),
        source: {
          LWQL_CLICKHOUSE_PASSWORD: "restricted-pw",
          LWQL_POSTGRES_READER_PASSWORD: "reader-pw",
          CLICKHOUSE_URL: "http://clickhouse:8123/bad-db!",
          DATABASE_URL: "postgresql://app:app@postgres:5432/app",
        },
        failOnError: true,
      });

      await expect(task.run({ args: [], signal: new AbortController().signal })).rejects.toThrow(
        'Invalid database name: "bad-db!"',
      );
    });
  });
});

describe("verifyAppFunctionsOnEveryReplica", () => {
  const missingOnOneHost = {
    name: "llm_readable_thread",
    missingOn: ["ch-1"],
    inKeeper: true,
    oneDefinition: true,
  };

  describe("when a Keeper-backed replica picks the function up within the wait", () => {
    it("passes once every replica lists it", async () => {
      const answers = [[missingOnOneHost], []];
      await expect(
        verifyAppFunctionsOnEveryReplica({
          findSplit: () => Promise.resolve(answers.shift() ?? []),
          waitMs: 1_000,
          pollMs: 1,
        }),
      ).resolves.toBeUndefined();
      expect(answers).toEqual([]);
    });
  });

  describe("when a function stays missing on one host", () => {
    /** @scenario "A created app function missing on one replica fails the provisioning step" */
    it("fails the step with the stable code", async () => {
      await expect(
        verifyAppFunctionsOnEveryReplica({
          findSplit: () => Promise.resolve([missingOnOneHost]),
          waitMs: 20,
          pollMs: 1,
        }),
      ).rejects.toMatchObject({ code: APP_FUNCTION_SPLIT_CODE });
    });
  });
});

describe("convergeLwqlAccessModel", () => {
  describe("when PostgreSQL refuses the reader role, as a managed server without CREATEROLE does", () => {
    /** @scenario "A PostgreSQL failure does not stop the ClickHouse objects converging" */
    it("logs its own message, still converges ClickHouse, then fails the run", async () => {
      const postgres = postgresThat({ refuses: true });
      const clickHouse = clickHouseThat();

      await expect(
        convergeLwqlAccessModel({
          database: postgres.database,
          plan: clickHouse.plan,
          failOnError: true,
        }),
      ).rejects.toMatchObject({ code: "P2010" });

      expect(clickHouse.ran.some((statement) => statement.includes("ENGINE = PostgreSQL"))).toBe(
        true,
      );
      expect(logCalls).toContainEqual(
        expect.objectContaining({
          level: "error",
          fields: expect.objectContaining({ code: "P2010", sqlState: "42501" }),
          message: "lwql provisioning failed creating PostgreSQL objects",
        }),
      );
      expect(JSON.stringify(logCalls)).not.toContain(READER_PASSWORD);
    });
  });

  describe("when the reconvergence check names only the drift it found", () => {
    const only = (drift: Partial<LwqlAppOwnedDrift>): LwqlAppOwnedDrift => ({
      clickHouse: [],
      postgres: [],
      isKeyMapMissing: false,
      ...drift,
    });
    const engineTable = selfProvisioning
      .appOwnedRelations({ names: NAMES })
      .find((name) => name.endsWith("_pg"));
    const approvedViews = selfProvisioning.approvedPostgresViews();
    const viewStatements = (view: string) =>
      LangWatchQLProductionProvisioningService.create().postgresApprovedViewStatements({
        schema: "public",
        readerRole: LWQL_POSTGRES_READER_ROLE,
        views: selfProvisioning.postgresDatasets({ approvedViews: [view] }),
      });

    /** @scenario "The reconvergence check skips the PostgreSQL half when the reader role and approved views are in place" */
    it("skips the PostgreSQL half when no approved view drifted, or PostgreSQL was unread", async () => {
      for (const postgresDrift of [[], "unknown"] as const) {
        const postgres = postgresThat({ refuses: false });
        const clickHouse = clickHouseThat();

        await convergeLwqlAccessModel({
          database: postgres.database,
          plan: clickHouse.plan,
          failOnError: true,
          only: only({ clickHouse: [engineTable ?? ""], postgres: postgresDrift }),
        });

        expect(postgres.ran).toEqual([]);
        expect(clickHouse.ran.filter((s) => s.includes("ENGINE = PostgreSQL"))).toHaveLength(1);
      }
    });

    /** @scenario "The reconvergence check skips the PostgreSQL half when the reader role and approved views are in place" */
    it("runs no ClickHouse DDL when only PostgreSQL drifted", async () => {
      const postgres = postgresThat({ refuses: false });
      const clickHouse = clickHouseThat();

      await convergeLwqlAccessModel({
        database: postgres.database,
        plan: clickHouse.plan,
        failOnError: true,
        only: only({ postgres: [{ view: approvedViews[0] ?? "", absent: true }] }),
      });

      expect(postgres.ran.length).toBeGreaterThan(0);
      expect(clickHouse.ran).toEqual([]);
    });

    /** @scenario "An older worker never rewrites a newer view" */
    it("creates only the absent approved view, grants SELECT on each gap and never revokes", async () => {
      const [absent, ungranted, untouched] = approvedViews;
      if (!absent || !ungranted || !untouched) throw new Error("the catalog maps too few datasets");
      const postgres = postgresThat({ refuses: false });
      const ran = (statement: string) => postgres.ran.some((run) => run.endsWith(statement));

      await convergeLwqlAccessModel({
        database: postgres.database,
        plan: clickHouseThat().plan,
        failOnError: true,
        only: only({
          postgres: [
            { view: absent, absent: true },
            { view: ungranted, absent: false },
          ],
        }),
      });

      expect(viewStatements(absent).every(ran)).toBe(true);
      expect(viewStatements(ungranted).some(ran)).toBe(false);
      expect(viewStatements(untouched).some(ran)).toBe(false);
      const grants = postgres.ran.join("\n");
      expect(grants).toContain(`GRANT SELECT ON "public"."${absent}"`);
      expect(grants).toContain(`GRANT SELECT ON "public"."${ungranted}"`);
      expect(grants).not.toContain(`"${untouched}" TO`);
      expect(grants).not.toMatch(/REVOKE|ALTER ROLE|CREATE ROLE/);
    });

    /** @scenario "An older worker never rewrites a newer view" */
    it("keeps the revokes and the full grants on a deploy's converge", async () => {
      const postgres = postgresThat({ refuses: false });

      await convergeLwqlAccessModel({ database: postgres.database, plan: clickHouseThat().plan });

      expect(postgres.ran.some((run) => run.includes("REVOKE ALL"))).toBe(true);
    });

    /** @scenario "A failed converge is retried by the next check and alerts once per change of failure" */
    it("logs its own failure at warn in other words than the alert, where a deploy logs the alert", async () => {
      const failing = /ENGINE = PostgreSQL/;
      const logsOf = async (drift: LwqlAppOwnedDrift | undefined, refuses: boolean) => {
        logCalls.length = 0;
        await convergeLwqlAccessModel({
          database: postgresThat({ refuses }).database,
          plan: clickHouseThat({ failing }).plan,
          ...(drift ? { only: drift } : {}),
        });
        return logCalls;
      };
      const alerts = [
        "lwql provisioning failed creating ClickHouse objects",
        "lwql provisioning failed creating PostgreSQL objects",
      ];
      const gap = { view: approvedViews[0] ?? "", absent: true };

      const check = await logsOf(only({ clickHouse: [engineTable ?? ""], postgres: [gap] }), true);
      expect(check.filter((call) => call.level === "error")).toEqual([]);
      expect(check.filter((call) => alerts.includes(String(call.message)))).toEqual([]);
      expect(check).toContainEqual(
        expect.objectContaining({
          level: "warn",
          fields: expect.objectContaining({ code: "P2010", sqlState: "42501" }),
          message: "lwql reconvergence statement failed",
        }),
      );

      const deploy = await logsOf(undefined, true);
      const errors = deploy.filter((call) => call.level === "error").map((call) => call.message);
      expect(errors).toEqual(expect.arrayContaining(alerts));
    });
  });
});

/** Three replicas holding no app function; Keeper has a function store or answers UNKNOWN_TABLE. */
function threeReplicasHoldingNoFunction({ keeperStore }: { keeperStore: boolean }) {
  const replicas = ["ch-0", "ch-1", "ch-2"].map((host) => ({ host, functions: {} }));
  return (sql: string): Record<string, unknown>[] | undefined => {
    if (sql.includes("system.replicas")) return [{ max_total_replicas: "3" }];
    if (sql.includes("system.clusters")) {
      return [{ name: "langwatch", hosts: "3", widest_shard: "3" }];
    }
    if (sql.includes("clusterAllReplicas")) return replicas;
    if (sql.includes("system.functions")) return [];
    if (sql.includes("system.zookeeper")) {
      if (!keeperStore) return [{ stores: "0" }];
      if (sql.includes("path = '/clickhouse/user_defined'")) return [];
      return [{ stores: sql.includes("name = 'user_defined'") ? "1" : "0" }];
    }
    return undefined;
  };
}

describe("findLwqlAppOwnedDrift", () => {
  const relations = selfProvisioning.appOwnedRelations({ names: NAMES });
  const approvedViews = selfProvisioning.approvedPostgresViews();
  const catalogColumns = LWQL_VIEW_CATALOG.flatMap((view) => view.columns.map((c) => c.name));

  /** Every app-owned object present, each with `columns`; a read of columns is answered too. */
  function presentWith({
    columns,
    postgresRead = true,
    appFunctionRows,
  }: {
    columns: string[];
    postgresRead?: boolean;
    /** Answers the function and replica-layout reads; unset, every app function is held. */
    appFunctionRows?: (sql: string) => Record<string, unknown>[] | undefined;
  }) {
    const database: LwqlProvisioningDatabase = {
      ...postgresThat({ refuses: false }).database,
      $queryRawUnsafe: async () => {
        if (!postgresRead) throw Object.assign(new Error("connection refused"), { code: "P1001" });
        return approvedViews.map((view) => ({ view, granted: true, columns }));
      },
    };
    const plan = {
      names: NAMES,
      schema: "public",
      openRepository: () =>
        ClickHouseLangWatchQLProvisioningRepository.create({
          statements: {
            command: async () => undefined,
            rows: async (sql: string) => {
              const layout = appFunctionRows?.(sql);
              if (layout !== undefined) return layout;
              if (sql.includes("system.functions")) {
                return lwqlAppFunctionNames().map((name) => ({ name }));
              }
              if (sql.includes("system.columns")) {
                return relations.map((table) => ({ table, columns }));
              }
              return relations.map((name) => ({ name }));
            },
            insert: async () => undefined,
          },
        }),
    };
    return findLwqlAppOwnedDrift({ database, plan });
  }

  /** @scenario "An older worker never rewrites a newer view" */
  it.each([
    {
      shape: "a newer deploy's extra columns",
      columns: [...catalogColumns, "AddedByANewerDeploy"],
    },
    { shape: "fewer columns than this worker's catalog declares", columns: ["TenantId"] },
  ])("finds no drift in objects holding $shape", async ({ columns }) => {
    expect(await presentWith({ columns })).toEqual({
      clickHouse: [],
      postgres: [],
      isKeyMapMissing: false,
    });
  });

  /** @scenario "The reconvergence check converges the app-owned LangWatchQL objects it finds missing" */
  it("reads an unreadable PostgreSQL as unknown, with a warning, never as a gap or as converged", async () => {
    const drift = await presentWith({ columns: catalogColumns, postgresRead: false });

    expect(drift.postgres).toBe("unknown");
    expect(logCalls).toContainEqual(
      expect.objectContaining({
        level: "warn",
        fields: expect.objectContaining({ code: "P1001" }),
      }),
    );
    expect(logCalls.map((call) => call.level)).not.toContain("error");
  });

  describe("given ClickHouse holds none of the app functions on three replicas", () => {
    function driftOverThreeReplicas({ keeperStore }: { keeperStore: boolean }) {
      return presentWith({
        columns: catalogColumns,
        appFunctionRows: threeReplicasHoldingNoFunction({ keeperStore }),
      });
    }

    it("expects no app function, and logs no error, where no Keeper function store exists", async () => {
      const drift = await driftOverThreeReplicas({ keeperStore: false });

      expect(drift.clickHouse).toEqual([]);
      expect(logCalls.map((call) => call.level)).not.toContain("error");
    });

    it("lists the declared app functions as missing where the Keeper function store exists", async () => {
      const drift = await driftOverThreeReplicas({ keeperStore: true });

      expect(drift.clickHouse).toEqual(lwqlAppFunctionNames());
    });
  });
});
