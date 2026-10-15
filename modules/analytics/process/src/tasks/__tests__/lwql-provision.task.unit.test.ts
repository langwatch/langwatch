import type * as Observability from "@langwatch/observability";
import { beforeEach, describe, expect, it, vi } from "vitest";

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
import {
  convergeLwqlAccessModel,
  type LwqlConvergencePlan,
  LwqlProvisionTask,
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
      keyMap: false,
      ...drift,
    });
    const [engineTable] = selfProvisioning
      .appOwnedRelations({ names: NAMES })
      .filter((relation) => relation.name.endsWith("_pg"));
    const approvedViews = selfProvisioning.approvedPostgresViews().map((view) => view.name);

    /** @scenario "The reconvergence check skips the PostgreSQL half when the reader role and approved views are in place" */
    it("skips the PostgreSQL half when no approved view drifted", async () => {
      const postgres = postgresThat({ refuses: false });
      const clickHouse = clickHouseThat();

      await convergeLwqlAccessModel({
        database: postgres.database,
        plan: clickHouse.plan,
        failOnError: true,
        only: only({ clickHouse: [engineTable?.name ?? ""] }),
      });

      expect(postgres.ran).toEqual([]);
      expect(clickHouse.ran.filter((s) => s.includes("ENGINE = PostgreSQL"))).toHaveLength(1);
    });

    /** @scenario "The reconvergence check skips the PostgreSQL half when the reader role and approved views are in place" */
    it("runs no ClickHouse DDL when only PostgreSQL drifted", async () => {
      const postgres = postgresThat({ refuses: false });
      const clickHouse = clickHouseThat();

      await convergeLwqlAccessModel({
        database: postgres.database,
        plan: clickHouse.plan,
        failOnError: true,
        only: only({ postgres: approvedViews.slice(0, 1) }),
      });

      expect(postgres.ran.length).toBeGreaterThan(0);
      expect(clickHouse.ran).toEqual([]);
    });

    /** @scenario "The reconvergence check converges the app-owned LangWatchQL objects it finds missing or stale" */
    it("re-creates only the drifted approved view, then converges the reader's grants", async () => {
      const [drifted, untouched] = approvedViews;
      if (!drifted || !untouched) throw new Error("the catalog maps too few PostgreSQL datasets");
      const postgres = postgresThat({ refuses: false });
      const viewStatements = (view: string) =>
        LangWatchQLProductionProvisioningService.create().postgresApprovedViewStatements({
          schema: "public",
          readerRole: LWQL_POSTGRES_READER_ROLE,
          views: selfProvisioning.postgresDatasets({ approvedViews: [view] }),
        });
      const ran = (statement: string) => postgres.ran.some((run) => run.endsWith(statement));

      await convergeLwqlAccessModel({
        database: postgres.database,
        plan: clickHouseThat().plan,
        failOnError: true,
        only: only({ postgres: [drifted] }),
      });

      expect(viewStatements(drifted).every(ran)).toBe(true);
      expect(viewStatements(untouched).some(ran)).toBe(false);
      expect(postgres.ran.some((run) => run.includes("REVOKE ALL"))).toBe(true);
    });

    /** @scenario "A failed converge is retried by the next check and alerts once per change of failure" */
    it("logs its own failure at warn, leaving the alert to the check, where a deploy logs error", async () => {
      const failing = /ENGINE = PostgreSQL/;
      const errorsOf = async (drift: LwqlAppOwnedDrift | undefined) => {
        logCalls.length = 0;
        await convergeLwqlAccessModel({
          database: postgresThat({ refuses: false }).database,
          plan: clickHouseThat({ failing }).plan,
          ...(drift ? { only: drift } : {}),
        });
        return logCalls.filter((call) => call.level === "error").map((call) => call.message);
      };

      expect(await errorsOf(only({ clickHouse: [engineTable?.name ?? ""] }))).toEqual([]);
      expect(await errorsOf(undefined)).toContain(
        "lwql provisioning failed creating ClickHouse objects",
      );
    });
  });
});
