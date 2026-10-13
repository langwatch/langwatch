/** @vitest-environment node */

import { randomUUID } from "node:crypto";

/**
 * API-key permission checks must not table-scan Grant. Assert rows examined
 * via planner, not index names.
 */
import type { AuthzPrincipalRef } from "@langwatch/authz-contract";
import { PrismaDriverAdapterService } from "@langwatch/prisma-client";
import { PrismaClient } from "@langwatch/prisma-client/generated";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { EventingAuthzReadRepository } from "../eventing.authz-read.repository.ts";

const ns = `authz-rolekey-${randomUUID().slice(0, 8)}`;
const organizationId = `${ns}-org`;
const apiKeyId = `${ns}-key`;
const roleId = `${ns}-role`;

/**
 * One organization holding far more grants than the rest is not a pathological
 * case invented for the test - it is the ordinary shape of a tenant that has
 * been used, and it is the shape under which this read stops being cheap.
 */
const FILLER_GRANTS = 20_000;

/**
 * The check wants a handful of holders. Anything of this order is "read what
 * you need"; the whole table is three orders of magnitude above it, so the
 * threshold does not have to be delicate to separate the two.
 */
const ROWS_A_CHECK_MAY_EXAMINE = 1_000;

type LoggedQuery = { sql: string; params: unknown[] };

/** Postgres's own account of one plan node. */
type PlanNode = {
  "Relation Name"?: string;
  "Actual Rows"?: number;
  "Actual Loops"?: number;
  "Rows Removed by Filter"?: number;
  Plans?: PlanNode[];
};

/**
 * Rows the executor actually touched on `Grant`, across every node that
 * read it: what it returned plus what it threw away, both counted, with
 * per-loop figures multiplied back out so a repeated scan isn't undercounted.
 */
function grantRowsExamined(node: PlanNode): number {
  const loops = node["Actual Loops"] ?? 1;
  const own =
    node["Relation Name"] === "Grant"
      ? ((node["Actual Rows"] ?? 0) + (node["Rows Removed by Filter"] ?? 0)) * loops
      : 0;
  return (node.Plans ?? []).reduce((total, child) => total + grantRowsExamined(child), own);
}

/**
 * The lane's Postgres, `DATABASE_URL` honoured for a stack setting only that.
 * Neither is not "the default database": Prisma dials one named after the OS
 * user, so the suite fails on the seed rather than skipping.
 */
const DB_URL = process.env.LANGWATCH_TEST_DATABASE_URL ?? process.env.DATABASE_URL;

describe.skipIf(!DB_URL)("given an organization holding many live grants", () => {
  let prisma: PrismaClient<"query">;
  const grantQueries: LoggedQuery[] = [];

  beforeAll(async () => {
    prisma = new PrismaClient({
      adapter: PrismaDriverAdapterService.create().create(DB_URL ?? "").adapter,
      log: [{ emit: "event", level: "query" }],
    });

    // The SQL under test is the SQL Prisma emits, not a paraphrase of it, so
    // it is taken from the client rather than written here.
    prisma.$on("query", (event) => {
      if (!event.query.includes('"Grant"')) return;
      grantQueries.push({
        sql: event.query,
        params: JSON.parse(event.params ?? "[]") as unknown[],
      });
    });

    await prisma.$executeRawUnsafe(
      `INSERT INTO "Role" (id, "organizationId", name, permissions, kind, "occurredAt", "createdAt", "updatedAt")
       VALUES ($1, $2, $3, '[]'::jsonb, 'system_api_key', now(), now(), now())`,
      roleId,
      organizationId,
      `${ns}-role-name`,
    );

    // The key's own grant on its private role: the row the check exists to
    // find, and the only row it should have to look at.
    await prisma.$executeRawUnsafe(
      `INSERT INTO "Grant" (id, "organizationId", "principalType", "principalId", "roleKey", source, "scopeType", "scopeId", "occurredAt", "createdAt", "updatedAt")
       VALUES ($1, $2, 'API_KEY', $3, $4, 'grants-service', 'ORGANIZATION', $2, now(), now(), now())`,
      `${ns}-own`,
      organizationId,
      apiKeyId,
      `custom:${roleId}`,
    );

    // Everything else the organization holds. Distinct role keys on purpose:
    // the column is selective, which is exactly why not indexing it costs.
    await prisma.$executeRawUnsafe(
      `INSERT INTO "Grant" (id, "organizationId", "principalType", "principalId", "roleKey", source, "scopeType", "scopeId", "occurredAt", "createdAt", "updatedAt")
       SELECT $1 || '-' || i, $2, 'USER', 'user-' || i, 'custom:role-' || (i % 500),
              'grants-service', 'ORGANIZATION', $2, now(), now(), now()
       FROM generate_series(1, ${FILLER_GRANTS}) AS i`,
      ns,
      organizationId,
    );

    // Without statistics the planner is guessing, and a guess is not evidence.
    await prisma.$executeRawUnsafe(`ANALYZE "Grant"`);
  }, 120_000);

  afterAll(async () => {
    await prisma.$executeRawUnsafe(
      `DELETE FROM "Grant" WHERE "organizationId" = $1`,
      organizationId,
    );
    await prisma.$executeRawUnsafe(
      `DELETE FROM "Role" WHERE "organizationId" = $1`,
      organizationId,
    );
    await prisma.$disconnect();
  });

  describe("when an API key asks which of its custom roles it holds alone", () => {
    it("answers without reading every grant", async () => {
      const repository = EventingAuthzReadRepository.create(prisma);
      const principal: AuthzPrincipalRef = { type: "apiKey", id: apiKeyId };

      grantQueries.length = 0;
      const permissions = await repository.findCustomRolePermissions({
        organizationId,
        principal,
        customRoleIds: [roleId],
      });

      // The key holds its private role exclusively, so the role survives the
      // filter. If this ever stops holding, the plan below is measuring the
      // wrong query.
      expect(permissions.map((row) => row.id)).toEqual([roleId]);

      const holderQuery = grantQueries.find((query) => query.sql.includes(`"roleKey"`));
      expect(holderQuery, "the holder lookup should have run").toBeDefined();

      const explained = await prisma.$queryRawUnsafe<
        { "QUERY PLAN": PlanNode[] | { Plan: PlanNode }[] }[]
      >(`EXPLAIN (ANALYZE, FORMAT JSON) ${holderQuery!.sql}`, ...holderQuery!.params);

      const root = explained[0]!["QUERY PLAN"][0] as { Plan: PlanNode };
      expect(grantRowsExamined(root.Plan)).toBeLessThan(ROWS_A_CHECK_MAY_EXAMINE);
    });
  });
});
