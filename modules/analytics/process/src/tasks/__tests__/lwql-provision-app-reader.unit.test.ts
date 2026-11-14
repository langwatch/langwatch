import { createHash } from "node:crypto";

import type * as Observability from "@langwatch/observability";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ClickHouseLangWatchQLProvisioningRepository } from "../../repositories/clickhouse/clickhouse.langwatch-ql-provisioning.repository.ts";
import type { LwqlProvisioningDatabase } from "../../repositories/langwatch-ql-postgres.repository.ts";
import {
  convergeAppReaders,
  LwqlProvisionTask,
  planAppReaderWalk,
} from "../lwql-provision.task.ts";

const logCalls: { level: string; fields: unknown; message: unknown }[] = [];

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

const SHARED_ADMIN = "http://default:admin@shared.invalid:8123/langwatch";
const SHARED_READER = "http://langwatch_app_reader:r%40der@shared.invalid:8123/langwatch";
const ENFORCING_READER = "http://langwatch_app_reader_enforcing:enf@shared.invalid:8123/langwatch";
const ONE_ADMIN = "http://default:one-admin@one.invalid:8123/tenantdb";
const ONE_READER = "http://langwatch_app_reader:one@one.invalid:8123/tenantdb";

const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");

/** One fake server per admin URL, recording each statement; `replicas` makes it a cluster. */
function fakeServers({ replicas = {} }: { replicas?: Record<string, number> } = {}) {
  const commands = new Map<string, string[]>();
  const open = (url: string) => {
    const ran = commands.get(url) ?? [];
    commands.set(url, ran);
    return ClickHouseLangWatchQLProvisioningRepository.create({
      statements: {
        async command(statement) {
          ran.push(statement);
        },
        async rows(sql) {
          if (sql.includes("system.replicas")) {
            return [{ max_total_replicas: String(replicas[url] ?? 0) }];
          }
          return [];
        },
        async insert() {},
      },
    });
  };
  return { open, commands };
}

beforeEach(() => {
  logCalls.length = 0;
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("planAppReaderWalk", () => {
  describe("given a process that holds no reader credential", () => {
    /** @scenario "An install that sets no reader credential provisions no reader and upgrades as before" */
    it("walks no server", () => {
      expect(
        planAppReaderWalk({
          source: { CLICKHOUSE_URL: SHARED_ADMIN, CLICKHOUSE_URL__acme__org_1: ONE_ADMIN },
        }),
      ).toEqual({ targets: [], unprovisioned: [] });
    });
  });

  describe("given a reader route with no system route", () => {
    /** @scenario "A server the upgrade cannot reach is named by the variable to set" */
    it("names the system variable the walk would need", () => {
      const walk = planAppReaderWalk({
        source: { CLICKHOUSE_READER_URL__acme__org_3: ONE_READER },
      });

      expect(walk.unprovisioned).toEqual([
        { target: "org_3", variable: "CLICKHOUSE_URL__acme__org_3" },
      ]);
    });
  });

  describe("given two organisations on one server with different reader passwords", () => {
    /** @scenario "A server the upgrade cannot reach is named by the variable to set" */
    it("provisions the first and names the second, never replacing a login", () => {
      const walk = planAppReaderWalk({
        source: {
          CLICKHOUSE_URL__acme__org_1: ONE_ADMIN,
          CLICKHOUSE_READER_URL__acme__org_1: ONE_READER,
          CLICKHOUSE_URL__beta__org_2: ONE_ADMIN,
          CLICKHOUSE_READER_URL__beta__org_2: ONE_READER.replace(":one@", ":two@"),
        },
      });

      expect(walk.targets.map((target) => target.target)).toEqual(["org_1"]);
      expect(walk.unprovisioned).toEqual([
        { target: "org_2", variable: "CLICKHOUSE_READER_URL__beta__org_2" },
      ]);
    });
  });
  describe("given an enforce switch neither true nor false", () => {
    /** @scenario "An enforce switch the upgrade cannot read is named, and its server is not provisioned" */
    it("names the shared switch and the route's switch, provisioning neither", () => {
      const walk = planAppReaderWalk({
        source: {
          CLICKHOUSE_URL: SHARED_ADMIN,
          CLICKHOUSE_READER_URL: SHARED_READER,
          CLICKHOUSE_TENANCY_ENFORCE: "maybe",
          CLICKHOUSE_URL__acme__org_1: ONE_ADMIN,
          CLICKHOUSE_READER_URL__acme__org_1: ONE_READER,
          CLICKHOUSE_TENANCY_ENFORCE__acme__org_1: "yes",
        },
      });

      expect(walk.targets).toEqual([]);
      expect(walk.unprovisioned).toEqual([
        { target: "shared", variable: "CLICKHOUSE_TENANCY_ENFORCE" },
        { target: "org_1", variable: "CLICKHOUSE_TENANCY_ENFORCE__acme__org_1" },
      ]);
    });
  });

  describe("given two organisations on one server with different enforce switches", () => {
    /** @scenario "An enforce switch the upgrade cannot read is named, and its server is not provisioned" */
    it("provisions the first and names the second's switch, never replacing its profile", () => {
      const walk = planAppReaderWalk({
        source: {
          CLICKHOUSE_URL__acme__org_1: ONE_ADMIN,
          CLICKHOUSE_READER_URL__acme__org_1: ONE_READER,
          CLICKHOUSE_URL__beta__org_2: ONE_ADMIN,
          CLICKHOUSE_READER_URL__beta__org_2: ONE_READER,
          CLICKHOUSE_TENANCY_ENFORCE__beta__org_2: "true",
        },
      });

      expect(walk.targets.map((target) => [target.target, target.enforce])).toEqual([
        ["org_1", false],
      ]);
      expect(walk.unprovisioned).toEqual([
        { target: "org_2", variable: "CLICKHOUSE_TENANCY_ENFORCE__beta__org_2" },
      ]);
    });
  });
});

describe("convergeAppReaders", () => {
  describe("given the shared reader in sql mode", () => {
    /** @scenario "The upgrade provisions the app reader in shadow on the shared server" */
    it("creates the reader with its password's hash and the enforce switch pinned off", async () => {
      const { open, commands } = fakeServers();

      const failed = await convergeAppReaders({
        source: {
          CLICKHOUSE_URL: SHARED_ADMIN,
          CLICKHOUSE_READER_URL: SHARED_READER,
          LWQL_ACCESS_MODEL_MODE: "sql",
        },
        open,
      });

      const ran = commands.get(SHARED_ADMIN) ?? [];
      expect(failed).toEqual([]);
      expect(ran).toContainEqual(
        expect.stringContaining(
          `CREATE USER OR REPLACE langwatch_app_reader IDENTIFIED WITH sha256_hash BY '${sha256("r@der")}'`,
        ),
      );
      expect(ran.join("\n")).toContain("SQL_langwatch_tenancy_enforce = '0' CONST");
      expect(ran.join("\n")).not.toContain("langwatch_app_reader_enforcing");
      expect(ran).toContainEqual(expect.stringMatching(/ON langwatch\.stored_spans/));
    });
  });

  describe("given the shadow sampler's reader is configured too", () => {
    /** @scenario "The upgrade provisions the app reader in shadow on the shared server" */
    it("creates the enforcing reader with enforce pinned on", async () => {
      const { open, commands } = fakeServers();

      await convergeAppReaders({
        source: {
          CLICKHOUSE_URL: SHARED_ADMIN,
          CLICKHOUSE_READER_URL: SHARED_READER,
          CLICKHOUSE_ENFORCING_READER_URL: ENFORCING_READER,
          LWQL_ACCESS_MODEL_MODE: "sql",
        },
        open,
      });

      const ran = (commands.get(SHARED_ADMIN) ?? []).join("\n");
      expect(ran).toContain(
        `CREATE USER OR REPLACE langwatch_app_reader_enforcing IDENTIFIED WITH sha256_hash BY '${sha256("enf")}'`,
      );
      expect(ran).toContain("SQL_langwatch_tenancy_enforce = '1' CONST");
    });
  });

  describe("given a private route with its reader route, and the shared server in rendered mode", () => {
    /** @scenario "The upgrade provisions the app reader on every routed server, as goose reaches them" */
    it("provisions the private server in sql mode and leaves the shared one to its rendered files", async () => {
      const { open, commands } = fakeServers();

      const failed = await convergeAppReaders({
        source: {
          CLICKHOUSE_URL: SHARED_ADMIN,
          CLICKHOUSE_READER_URL: SHARED_READER,
          CLICKHOUSE_ENFORCING_READER_URL: ENFORCING_READER,
          CLICKHOUSE_URL__acme__org_1: ONE_ADMIN,
          CLICKHOUSE_READER_URL__acme__org_1: ONE_READER,
        },
        open,
      });

      const ran = (commands.get(ONE_ADMIN) ?? []).join("\n");
      expect(failed).toEqual([]);
      expect(commands.has(SHARED_ADMIN)).toBe(false);
      expect(ran).toContain(`IDENTIFIED WITH sha256_hash BY '${sha256("one")}'`);
      expect(ran).toContain("ON tenantdb.stored_spans");
      expect(ran).not.toContain("langwatch_app_reader_enforcing");
    });
  });

  describe("given the shared server's enforce switch on", () => {
    /** @scenario "The upgrade enforces the reader's tenant set where its server's switch is on" */
    it("pins the reader's enforce setting to 1", async () => {
      const { open, commands } = fakeServers();

      await convergeAppReaders({
        source: {
          CLICKHOUSE_URL: SHARED_ADMIN,
          CLICKHOUSE_READER_URL: SHARED_READER,
          CLICKHOUSE_TENANCY_ENFORCE: "true",
          LWQL_ACCESS_MODEL_MODE: "sql",
        },
        open,
      });

      const ran = (commands.get(SHARED_ADMIN) ?? []).join("\n");
      expect(ran).toContain("SQL_langwatch_tenancy_enforce = '1' CONST");
      expect(ran).not.toContain("SQL_langwatch_tenancy_enforce = '0' CONST");
    });
  });

  describe("given one route's enforce switch on and the shared server's unset", () => {
    /** @scenario "The upgrade enforces the reader's tenant set where its server's switch is on" */
    it("enforces on that route's server only", async () => {
      const { open, commands } = fakeServers();

      await convergeAppReaders({
        source: {
          CLICKHOUSE_URL: SHARED_ADMIN,
          CLICKHOUSE_READER_URL: SHARED_READER,
          LWQL_ACCESS_MODEL_MODE: "sql",
          CLICKHOUSE_URL__acme__org_1: ONE_ADMIN,
          CLICKHOUSE_READER_URL__acme__org_1: ONE_READER,
          CLICKHOUSE_TENANCY_ENFORCE__acme__org_1: "1",
        },
        open,
      });

      expect((commands.get(ONE_ADMIN) ?? []).join("\n")).toContain(
        "SQL_langwatch_tenancy_enforce = '1' CONST",
      );
      expect((commands.get(SHARED_ADMIN) ?? []).join("\n")).toContain(
        "SQL_langwatch_tenancy_enforce = '0' CONST",
      );
    });
  });

  describe("given a private route with no reader route while the process holds a reader", () => {
    /** @scenario "A routed server without the reader is named, and the client refuses its reader reads by that name" */
    it("provisions nothing there and names the reader variable the client refuses by", async () => {
      const { open, commands } = fakeServers();

      await convergeAppReaders({
        source: {
          CLICKHOUSE_URL: SHARED_ADMIN,
          CLICKHOUSE_READER_URL: SHARED_READER,
          LWQL_ACCESS_MODEL_MODE: "sql",
          CLICKHOUSE_URL__acme__org_2: ONE_ADMIN,
        },
        open,
      });

      expect(commands.has(ONE_ADMIN)).toBe(false);
      expect(logCalls).toContainEqual(
        expect.objectContaining({
          level: "warn",
          fields: { target: "org_2", variable: "CLICKHOUSE_READER_URL__acme__org_2" },
        }),
      );
    });
  });

  describe("given a private server on a cluster without replicated access storage", () => {
    /** @scenario "A routed server the reader cannot be provisioned on fails the upgrade by name" */
    it("runs no DDL there, reports it failed and still provisions the other servers", async () => {
      const { open, commands } = fakeServers({ replicas: { [ONE_ADMIN]: 3 } });

      const failed = await convergeAppReaders({
        source: {
          CLICKHOUSE_URL: SHARED_ADMIN,
          CLICKHOUSE_READER_URL: SHARED_READER,
          LWQL_ACCESS_MODEL_MODE: "sql",
          LWQL_ACCESS_MODEL_SQL_SINGLE_NODE: "true",
          CLICKHOUSE_URL__acme__org_1: ONE_ADMIN,
          CLICKHOUSE_READER_URL__acme__org_1: ONE_READER,
        },
        open,
      });

      expect(failed).toEqual(["org_1"]);
      expect(commands.get(ONE_ADMIN)).toEqual([]);
      expect(commands.get(SHARED_ADMIN)?.length).toBeGreaterThan(0);
    });
  });
});

describe("LwqlProvisionTask and the app reader", () => {
  const database = () => ({}) as LwqlProvisioningDatabase;
  const run = (task: LwqlProvisionTask) =>
    task.run({ args: [], signal: new AbortController().signal });

  describe("given an install that sets no reader credential", () => {
    /** @scenario "An install that sets no reader credential provisions no reader and upgrades as before" */
    it("opens no ClickHouse connection for the reader and completes", async () => {
      const opened = vi.spyOn(ClickHouseLangWatchQLProvisioningRepository, "open");

      await run(
        LwqlProvisionTask.create({
          database,
          source: { CLICKHOUSE_URL: SHARED_ADMIN },
          failOnError: true,
        }),
      );

      expect(opened).not.toHaveBeenCalled();
    });
  });

  describe("when the upgrade's reconciler runs it and a routed server refuses the reader", () => {
    /** @scenario "A routed server the reader cannot be provisioned on fails the upgrade by name" */
    it("fails the run naming the organisation", async () => {
      const { open } = fakeServers({ replicas: { [ONE_ADMIN]: 3 } });
      vi.spyOn(ClickHouseLangWatchQLProvisioningRepository, "open").mockImplementation(({ url }) =>
        open(url ?? ""),
      );

      await expect(
        run(
          LwqlProvisionTask.create({
            database,
            source: {
              CLICKHOUSE_URL__acme__org_1: ONE_ADMIN,
              CLICKHOUSE_READER_URL__acme__org_1: ONE_READER,
            },
            failOnError: true,
          }),
        ),
      ).rejects.toThrow("app reader provisioning failed on: org_1");
    });
  });
});
