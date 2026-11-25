/**
 * The scoped-reader state read's raw SQL on a real Postgres of its own: the group, its scoped
 * schema and marker, each copy's guard and grant, and its grants on shared views.
 * @see specs/lwql/api.feature
 * @vitest-environment node
 */

import { randomUUID } from "node:crypto";

import { createLogger } from "@langwatch/observability";
import {
  type PrismaConnection,
  PrismaConfigService,
  PrismaConnectionService,
  PrismaQueryGuard,
  type PrismaQueryContext,
  type PrismaQueryExecutor,
} from "@langwatch/prisma-client";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { scopedSchemaMarker } from "../../../features/provisioning/rules/lwql-scoped-view.rules.ts";
import { TEST_POSTGRES_IMAGE } from "../../../langwatch-ql/__tests__/lwql-clickhouse-harness.ts";
import type { LwqlScopedViewState } from "../../langwatch-ql-postgres.repository.ts";
import { PrismaLangWatchQLPostgresRepository } from "../prisma.langwatch-ql-postgres.repository.ts";

class AllowTestQueries extends PrismaQueryGuard {
  execute(context: PrismaQueryContext, next: PrismaQueryExecutor): Promise<unknown> {
    return next(context.args);
  }
}

const suffix = randomUUID().replaceAll("-", "").slice(0, 12);
const APP_SCHEMA = `lwql_probe_${suffix}`;
const GROUP = `lwql_probe_group_${suffix}`;
const ABSENT_GROUP = `lwql_probe_absent_${suffix}`;
const SHARED_GRANTED = "shared_granted";
const SCOPED_OK = "copy_scoped";
const LOOK_ALIKE = "copy_look_alike";
const UNGRANTED = "copy_ungranted";
const MISSING = "copy_missing";
const VIEWS = [LOOK_ALIKE, MISSING, SCOPED_OK, SHARED_GRANTED, UNGRANTED];

/** A body carrying the org-role lookup tied to the current user, as the scoped-view check asks. */
const SCOPED_BODY =
  `SELECT b.id FROM "${APP_SCHEMA}".base b WHERE EXISTS (SELECT 1 FROM pg_roles g ` +
  `JOIN pg_auth_members m ON m.roleid = g.oid ` +
  `JOIN pg_roles u ON u.oid = m.member AND u.rolname = current_user ` +
  `WHERE g.rolname = 'lwql_org_'::text || md5(b.id::text))`;

describe("the scoped-reader state read over a real Postgres", () => {
  let container: StartedPostgreSqlContainer;
  let connection: PrismaConnection;

  const run = (statement: string) => connection.client.$executeRawUnsafe(statement);
  const stateFor = (group: string): Promise<LwqlScopedViewState> =>
    PrismaLangWatchQLPostgresRepository.create(connection.client).findScopedViewState({
      appSchema: APP_SCHEMA,
      group,
      views: VIEWS,
    });
  const copyOf = (state: LwqlScopedViewState, view: string) =>
    state.copies.find((copy) => copy.view === view);

  beforeAll(async () => {
    container = await new PostgreSqlContainer(TEST_POSTGRES_IMAGE)
      .withLabels({ "langwatch.test": "true", "langwatch.test.type": "integration" })
      .start();
    connection = PrismaConnectionService.create({
      guard: new AllowTestQueries(),
      logger: createLogger("langwatch:analytics:lwql-scoped-state-test"),
    }).connect(
      PrismaConfigService.create().resolve({
        databaseUrl: container.getConnectionUri(),
        log: ["error"],
      }),
    );
    await run(`CREATE SCHEMA "${APP_SCHEMA}"`);
    await run(`CREATE TABLE "${APP_SCHEMA}".base (id int)`);
    await run(
      `CREATE VIEW "${APP_SCHEMA}"."${SHARED_GRANTED}" AS SELECT id FROM "${APP_SCHEMA}".base`,
    );
  }, 120_000);

  afterAll(async () => {
    await connection?.closeOnce();
    await container?.stop();
  });

  describe("given the group does not exist", () => {
    /** @scenario "The scoped-reader state read reports nothing and raises nothing without the group" */
    it("reads no group, no schema, no copy and raises nothing", async () => {
      await expect(stateFor(ABSENT_GROUP)).resolves.toEqual({
        groupExists: false,
        scopedSchema: "absent",
        groupOnShared: [],
        copies: [],
      });
    });
  });

  describe("given the group exists and lwql_scoped does not", () => {
    let state: LwqlScopedViewState;

    beforeAll(async () => {
      await run(`CREATE ROLE "${GROUP}" NOLOGIN`);
      await run(`GRANT SELECT ON "${APP_SCHEMA}"."${SHARED_GRANTED}" TO "${GROUP}"`);
      state = await stateFor(GROUP);
    });

    it("reads the scoped schema as absent and every copy as absent", () => {
      expect(state.scopedSchema).toBe("absent");
      expect(state.copies.filter((copy) => copy.exists)).toEqual([]);
    });

    /** @scenario "The reconvergence check guards every scoped copy" */
    it("names the shared view the group holds SELECT on", () => {
      expect(state.groupOnShared).toEqual([SHARED_GRANTED]);
    });
  });

  describe("given lwql_scoped marked as this installation's, with copies of each kind", () => {
    let state: LwqlScopedViewState;

    beforeAll(async () => {
      await run(`CREATE SCHEMA lwql_scoped`);
      await run(
        `COMMENT ON SCHEMA lwql_scoped IS '${scopedSchemaMarker({ appSchema: APP_SCHEMA })}'`,
      );
      await run(`GRANT USAGE ON SCHEMA lwql_scoped TO "${GROUP}"`);
      for (const view of [SCOPED_OK, UNGRANTED]) {
        await run(
          `CREATE VIEW lwql_scoped."${view}" WITH (security_barrier = true) AS ${SCOPED_BODY}`,
        );
      }
      await run(`CREATE VIEW lwql_scoped."${LOOK_ALIKE}" AS SELECT id FROM "${APP_SCHEMA}".base`);
      for (const view of [SCOPED_OK, LOOK_ALIKE]) {
        await run(`GRANT SELECT ON lwql_scoped."${view}" TO "${GROUP}"`);
      }
      state = await stateFor(GROUP);
    });

    /** @scenario "The scoped-reader state read reports nothing and raises nothing without the group" */
    it("reads the scoped schema as owned", () => {
      expect(state.scopedSchema).toBe("owned");
    });

    /** @scenario "The scoped-reader state read reports nothing and raises nothing without the group" */
    it("reads a scoped, granted copy as passing and granted", () => {
      expect(copyOf(state, SCOPED_OK)).toEqual({
        view: SCOPED_OK,
        exists: true,
        passesGuard: true,
        granted: true,
      });
    });

    /** @scenario "The scoped-reader state read reports nothing and raises nothing without the group" */
    it("reads an unscoped look-alike as failing the guard, its stale grant included", () => {
      expect(copyOf(state, LOOK_ALIKE)).toEqual({
        view: LOOK_ALIKE,
        exists: true,
        passesGuard: false,
        granted: true,
      });
    });

    it("reads a scoped copy without its grant as ungranted", () => {
      expect(copyOf(state, UNGRANTED)).toMatchObject({ passesGuard: true, granted: false });
    });

    it("reads a missing copy as absent", () => {
      expect(copyOf(state, MISSING)).toMatchObject({ exists: false, passesGuard: false });
    });
  });

  describe("given lwql_scoped marked as another installation's", () => {
    /** @scenario "A scoped schema marked as another installation's is left alone" */
    it("reads the scoped schema as foreign", async () => {
      await run(`COMMENT ON SCHEMA lwql_scoped IS 'langwatch-lwql-scoped:another_app_schema'`);

      expect((await stateFor(GROUP)).scopedSchema).toBe("foreign");
    });
  });
});
