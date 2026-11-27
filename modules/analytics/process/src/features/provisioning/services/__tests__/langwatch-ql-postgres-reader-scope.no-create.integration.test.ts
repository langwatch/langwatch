/**
 * The scoped part fails closed, by the task's own converge run as the app role: without CREATE on
 * the database, or with lwql_scoped marked as another installation's, the shared half converges,
 * one warning is logged, and the scoped-reader group can select nothing.
 * @see ../../../../tasks/lwql-provision.task.ts
 * @vitest-environment node
 */

import type * as Observability from "@langwatch/observability";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { convergeLwqlAccessModel } from "../../../../tasks/lwql-provision.task.ts";
import {
  GROUP,
  LOGIN_PASSWORD,
  postgresOnlyPlan,
  q,
  SCHEMA,
  SCOPED,
  type ScopeHarness,
  SHARED_READER,
  startScopeHarness,
  VIEW_NAMES,
} from "./langwatch-ql-postgres-reader-scope.fixtures.ts";

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

/** A non-superuser app role that owns the app schema and every relation in it. */
const APP_ROLE = "lwql_app";

/** Hands the app schema and each relation in it to the app role, as Prisma's role holds them. */
const OWN_APP_SCHEMA = `DO $$
DECLARE
  r record;
BEGIN
  EXECUTE format('ALTER SCHEMA %I OWNER TO ${APP_ROLE}', '${SCHEMA}');
  FOR r IN
    SELECT c.relname, c.relkind FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = '${SCHEMA}' AND c.relkind IN ('r', 'p', 'v', 'm', 'S')
      AND NOT (c.relkind = 'S' AND EXISTS (
        SELECT 1 FROM pg_depend d WHERE d.objid = c.oid AND d.deptype IN ('a', 'i')))
  LOOP
    EXECUTE format('ALTER %s %I.%I OWNER TO ${APP_ROLE}',
      CASE r.relkind WHEN 'v' THEN 'VIEW' WHEN 'm' THEN 'MATERIALIZED VIEW'
        WHEN 'S' THEN 'SEQUENCE' ELSE 'TABLE' END,
      '${SCHEMA}', r.relname);
  END LOOP;
END
$$`;

const POSTGRES_FAILED = "lwql provisioning failed creating PostgreSQL objects";

describe("given a scoped-reader group and an app role that owns the app schema", () => {
  let harness: ScopeHarness;

  /** A deploy's converge, run by the task as the app role; its ClickHouse half is refused. */
  async function deployAsAppRole(): Promise<void> {
    logCalls.length = 0;
    const connection = harness.connect(APP_ROLE);
    try {
      await convergeLwqlAccessModel({ database: connection.database, plan: postgresOnlyPlan() });
    } finally {
      await connection.close();
    }
  }

  const warnings = (fragment: string) =>
    logCalls.filter((call) => call.level === "warn" && String(call.message).includes(fragment));

  beforeAll(async () => {
    harness = await startScopeHarness({ provision: false });
    await harness.admin(`CREATE ROLE ${APP_ROLE} LOGIN CREATEROLE PASSWORD '${LOGIN_PASSWORD}'`);
    // Prisma's role created the shared reader, so it may alter it: ADMIN on it, as PG 16+ asks.
    await harness.admin(`GRANT ${SHARED_READER} TO ${APP_ROLE} WITH ADMIN OPTION`);
    await harness.admin(OWN_APP_SCHEMA);
    // Stale reach the deploy's revokes must take away, so "selects nothing" is not vacuous.
    await harness.admin(`GRANT USAGE ON SCHEMA ${q(SCHEMA)} TO ${GROUP}`);
    await harness.admin(`GRANT SELECT ON ${q(SCHEMA)}.${q(VIEW_NAMES[0] as string)} TO ${GROUP}`);
    await harness.admin(`REVOKE CREATE ON DATABASE lwtest FROM PUBLIC, ${APP_ROLE}`);
  }, 600_000);

  afterAll(async () => {
    await harness?.stop();
  });

  describe("when a deploy converges without CREATE on the database and lwql_scoped absent", () => {
    let createOnDatabase: string;

    beforeAll(async () => {
      createOnDatabase = await harness.admin(
        `SELECT has_database_privilege('${APP_ROLE}', 'lwtest', 'CREATE')`,
      );
      await deployAsAppRole();
    });

    it("runs as a role without CREATE on the database", () => {
      expect(createOnDatabase).toBe("f");
    });

    /** @scenario "Without CREATE on the database, the scoped part fails closed" */
    it("converges the shared views and the shared reader, raising nothing", async () => {
      const shared = await harness.readAllViews({ user: SHARED_READER, schema: SCHEMA });

      expect(Object.keys(shared).toSorted()).toEqual(VIEW_NAMES.toSorted());
      expect(logCalls.filter((call) => call.message === POSTGRES_FAILED)).toEqual([]);
      expect(warnings("could not write the scoped-reader copies")).toEqual([]);
    });

    /** @scenario "Without CREATE on the database, the scoped part fails closed" */
    it("leaves no scoped schema", async () => {
      expect(await harness.admin(`SELECT to_regnamespace('${SCOPED}') IS NULL`)).toBe("t");
    });

    /** @scenario "Without CREATE on the database, the scoped part fails closed" */
    it("logs one warning, naming the absent scoped schema", () => {
      const scoped = logCalls.filter(
        (call) => call.level === "warn" && String(call.message).includes("scoped"),
      );

      expect(scoped).toEqual([
        expect.objectContaining({ message: expect.stringContaining("lwql_scoped is absent") }),
      ]);
    });

    /** @scenario "Without CREATE on the database, the scoped part fails closed" */
    it("leaves the group SELECT on no relation and USAGE on no schema", async () => {
      expect(await harness.selectableBy(GROUP)).toEqual([]);
      expect(await harness.directSchemaUsage(GROUP)).toEqual([]);
    });
  });

  describe("when lwql_scoped already exists, marked as another installation's", () => {
    beforeAll(async () => {
      await harness.admin(`GRANT CREATE ON DATABASE lwtest TO ${APP_ROLE}`);
      await harness.admin(`CREATE SCHEMA ${q(SCOPED)} AUTHORIZATION ${APP_ROLE}`);
      await harness.admin(
        `COMMENT ON SCHEMA ${q(SCOPED)} IS 'langwatch-lwql-scoped:another_app_schema'`,
      );
      await deployAsAppRole();
    });

    /** @scenario "A scoped schema marked as another installation's is left alone" */
    it("writes no copy into it", async () => {
      expect(
        await harness.admin(
          `SELECT count(*) FROM pg_class WHERE relnamespace = '${SCOPED}'::regnamespace`,
        ),
      ).toBe("0");
    });

    /** @scenario "A scoped schema marked as another installation's is left alone" */
    it("leaves the group SELECT on no relation and no USAGE on the schema", async () => {
      expect(await harness.selectableBy(GROUP)).toEqual([]);
      expect(await harness.directSchemaUsage(GROUP)).toEqual([]);
    });

    /** @scenario "A scoped schema marked as another installation's is left alone" */
    it("logs one warning, naming the unmarked schema", () => {
      expect(warnings("not marked as this installation's")).toHaveLength(1);
      expect(warnings("lwql_scoped is absent")).toEqual([]);
    });

    it("still converges the shared views", async () => {
      const shared = await harness.readAllViews({ user: SHARED_READER, schema: SCHEMA });

      expect(Object.keys(shared).toSorted()).toEqual(VIEW_NAMES.toSorted());
      expect(logCalls.filter((call) => call.message === POSTGRES_FAILED)).toEqual([]);
    });
  });
});
