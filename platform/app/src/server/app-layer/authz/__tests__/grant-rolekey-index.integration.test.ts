/**
 * @vitest-environment node
 *
 * An API-key permission check must not read the whole `Grant` table.
 *
 * `findCustomRolePermissions` asks who else holds a key's private role, and
 * that question is answered by `(organizationId, roleKey)`. No index carried
 * `roleKey`, so Postgres had nothing selective to descend and fell back to
 * reading every live grant the organization owns - on every check, to return
 * a handful of rows.
 *
 * The defect is invisible at demo scale and invisible in a unit test: it is a
 * planner decision, so proving it needs a real Postgres, real statistics, and
 * enough rows that "reads everything" and "reads what it needs" are different
 * numbers. So this suite seeds a lopsided organization, drives the real public
 * method, captures the SQL Prisma actually emitted, and asks the planner what
 * it did with it.
 *
 * The assertion is rows EXAMINED, not the name of an index or the absence of
 * a sequential scan. Those are shapes a future plan is allowed to change; the
 * promise is that a check for a few rows does not pay for the whole table.
 *
 * @see specs/rbac/unified-authorization-engine.feature
 */
import type { AuthzPrincipalRef } from "@langwatch/authz";
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Prisma } from "~/generated/prisma/client";
import { PrismaClient } from "~/generated/prisma/client";
import { createPrismaPgAdapter } from "~/server/prismaPgAdapter";
import { GrantsAuthzReadRepository } from "../repositories/authz-read.grants.repository";

const ns = `authz-rolekey-${nanoid(8)}`;
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
 * Rows the executor actually touched on `Grant`, across every node that read
 * it. A node reports what it returned; what it threw away is accounted for
 * separately, and both were read. Per-loop figures are multiplied back out so
 * a parallel or repeated scan is not undercounted.
 */
function grantRowsExamined(node: PlanNode): number {
  const loops = node["Actual Loops"] ?? 1;
  const own =
    node["Relation Name"] === "Grant"
      ? ((node["Actual Rows"] ?? 0) + (node["Rows Removed by Filter"] ?? 0)) *
        loops
      : 0;
  return (node.Plans ?? []).reduce(
    (total, child) => total + grantRowsExamined(child),
    own,
  );
}

describe("given an organization holding many live grants", () => {
  let prisma: PrismaClient;
  const grantQueries: LoggedQuery[] = [];

  beforeAll(async () => {
    prisma = new PrismaClient({
      adapter: createPrismaPgAdapter(process.env.DATABASE_URL ?? ""),
      log: [{ emit: "event", level: "query" }],
    });

    // The SQL under test is the SQL Prisma emits, not a paraphrase of it, so
    // it is taken from the client rather than written here.
    (
      prisma as unknown as { $on: (e: string, cb: (q: never) => void) => void }
    ).$on("query", (event: never) => {
      const e = event as unknown as { query: string; params?: string };
      if (!e.query.includes('"Grant"')) return;
      grantQueries.push({
        sql: e.query,
        params: JSON.parse(e.params ?? "[]") as unknown[],
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
      const repository = new GrantsAuthzReadRepository(
        prisma as unknown as Prisma.TransactionClient,
      );
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

      const holderQuery = grantQueries.find((query) =>
        query.sql.includes(`"roleKey"`),
      );
      expect(holderQuery, "the holder lookup should have run").toBeDefined();

      const explained = await prisma.$queryRawUnsafe<
        Array<{ "QUERY PLAN": PlanNode[] | Array<{ Plan: PlanNode }> }>
      >(
        `EXPLAIN (ANALYZE, FORMAT JSON) ${holderQuery!.sql}`,
        ...holderQuery!.params,
      );

      const root = explained[0]!["QUERY PLAN"][0] as { Plan: PlanNode };
      expect(grantRowsExamined(root.Plan)).toBeLessThan(
        ROWS_A_CHECK_MAY_EXAMINE,
      );
    });
  });
});
