/**
 * The scoped-reader gap probe's raw SQL on a real Postgres, in its own schema and random roles.
 * @see specs/lwql/api.feature
 * @vitest-environment node
 */

import { randomUUID } from "node:crypto";

import { createLogger } from "@langwatch/observability";
import {
  PrismaConfigService,
  PrismaConnectionService,
  PrismaQueryGuard,
  type PrismaQueryContext,
  type PrismaQueryExecutor,
} from "@langwatch/prisma-client";
import type { PrismaClient } from "@langwatch/prisma-client/generated";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { PrismaLangWatchQLPostgresRepository } from "../prisma.langwatch-ql-postgres.repository.ts";

class AllowTestQueries extends PrismaQueryGuard {
  execute(context: PrismaQueryContext, next: PrismaQueryExecutor): Promise<unknown> {
    return next(context.args);
  }
}

const databaseUrl = process.env.DATABASE_URL;
const connection = databaseUrl
  ? PrismaConnectionService.create({
      guard: new AllowTestQueries(),
      logger: createLogger("langwatch:analytics:lwql-scoped-reader-probe-test"),
    }).connect(PrismaConfigService.create().resolve({ databaseUrl, log: ["error"] }))
  : null;

function database(): PrismaClient {
  if (connection === null) {
    throw new Error("DATABASE_URL is required for the scoped-reader probe tests");
  }

  return connection.client;
}

const suffix = randomUUID().replaceAll("-", "").slice(0, 12);
const SCHEMA = `lwql_probe_${suffix}`;
const ROLE = `lwql_probe_reader_${suffix}`;
const ABSENT_ROLE = `lwql_probe_absent_${suffix}`;
const GRANTED_VIEW = "granted_view";
const UNGRANTED_VIEW = "ungranted_view";
const MISSING_VIEW = "missing_view";
const ALL_VIEWS = [GRANTED_VIEW, MISSING_VIEW, UNGRANTED_VIEW];

const run = (statement: string) => database().$executeRawUnsafe(statement);
const missingFor = (role: string) =>
  PrismaLangWatchQLPostgresRepository.create(database()).findScopedReaderMissingViews({
    schema: SCHEMA,
    role,
    views: ALL_VIEWS,
  });

async function dropEverything(): Promise<void> {
  await run(`DROP SCHEMA IF EXISTS "${SCHEMA}" CASCADE`);
  await run(`DROP OWNED BY "${ROLE}"`).catch(() => 0);
  await run(`DROP ROLE IF EXISTS "${ROLE}"`);
}

describe.skipIf(!databaseUrl)("the scoped-reader gap probe over a real Postgres", () => {
  beforeAll(async () => {
    await dropEverything();
    await run(`CREATE SCHEMA "${SCHEMA}"`);
    await run(`CREATE TABLE "${SCHEMA}".base (id int)`);
    for (const view of [GRANTED_VIEW, UNGRANTED_VIEW]) {
      await run(`CREATE VIEW "${SCHEMA}"."${view}" AS SELECT id FROM "${SCHEMA}".base`);
    }
    await run(`CREATE ROLE "${ROLE}" NOLOGIN`);
    await run(`GRANT SELECT ON "${SCHEMA}"."${GRANTED_VIEW}" TO "${ROLE}"`);
  }, 60_000);

  afterAll(async () => {
    try {
      await dropEverything();
    } finally {
      await connection?.closeOnce();
    }
  });

  describe("given the role does not exist", () => {
    /** @scenario "The scoped-reader gap probe on a deployment without the group reports nothing and raises nothing" */
    it("names no view and raises no error, even with live views to check", async () => {
      await expect(missingFor(ABSENT_ROLE)).resolves.toEqual([]);
    });
  });

  describe("given the role exists", () => {
    let missing: string[];

    beforeAll(async () => {
      missing = await missingFor(ROLE);
    });

    it("does not name a view that does not exist", () => {
      expect(missing).not.toContain(MISSING_VIEW);
    });

    it("names a live view the role has no SELECT on", () => {
      expect(missing).toContain(UNGRANTED_VIEW);
    });

    it("does not name a live view the role holds SELECT on", () => {
      expect(missing).not.toContain(GRANTED_VIEW);
    });

    it("names exactly the ungranted live views", () => {
      expect(missing).toEqual([UNGRANTED_VIEW]);
    });
  });
});
