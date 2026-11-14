/**
 * Barrier and pushdown guards: every view is a security barrier, and a TenantId filter still
 * lands on the tenant relation's scan on the widest join paths.
 * @see ../langwatch-ql-postgres-views.service.ts
 * @vitest-environment node
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  PROJECT_A,
  q,
  SCHEMA,
  type ScopeHarness,
  SHARED_READER,
  startScopeHarness,
  VIEW_NAMES,
  VIEWS,
} from "./langwatch-ql-postgres-reader-scope.fixtures.ts";

type View = (typeof VIEWS)[number];

type PlanNode = {
  "Node Type": string;
  "Relation Name"?: string;
  Filter?: string;
  "Index Cond"?: string;
  "Recheck Cond"?: string;
  Plans?: PlanNode[];
};

const flatten = (node: PlanNode): PlanNode[] => [node, ...(node.Plans ?? []).flatMap(flatten)];
const depth = (view: View): number => view.postgres.tenantPath?.length ?? 0;

describe("given the generated Postgres views", () => {
  let harness: ScopeHarness;
  const admin = (sql: string) => harness.admin(sql);

  beforeAll(async () => {
    harness = await startScopeHarness();
  }, 600_000);

  afterAll(async () => {
    await harness?.stop();
  });

  describe("when the views are inspected", () => {
    it("every view has security_barrier=true", async () => {
      const list = VIEW_NAMES.map((n) => `'${n}'`).join(",");
      const offenders = await admin(
        `SELECT coalesce(string_agg(relname, ','), '') FROM pg_class WHERE relnamespace = '${SCHEMA}'::regnamespace AND relname IN (${list}) AND NOT ('security_barrier=true' = ANY(coalesce(reloptions, '{}')))`,
      );

      expect(offenders).toBe("");
    });
  });

  describe("when the shared reader filters one tenant on the widest join paths (pushdown performance guard)", () => {
    const widest = VIEWS.toSorted(
      (a, b) =>
        depth(b) - depth(a) || a.postgres.approvedView.localeCompare(b.postgres.approvedView),
    ).slice(0, 3);

    const planOf = async (view: string): Promise<PlanNode[]> => {
      const out = await harness.runAs({
        user: SHARED_READER,
        sql: `EXPLAIN (FORMAT JSON) SELECT * FROM ${q(SCHEMA)}.${q(view)} WHERE "TenantId" = '${PROJECT_A}'`,
      });

      return flatten(JSON.parse(out)[0].Plan);
    };

    it("selects views that have a join path", () => {
      expect(widest.every((view) => depth(view) > 0)).toBe(true);
    });

    // Without the barrier these plans prove nothing about it: the guards below are only
    // meaningful on a view that really is one.
    it.each(widest.map((view) => view.postgres.approvedView))(
      "%s: is a barrier view",
      async (view) => {
        expect(
          await admin(
            `SELECT 'security_barrier=true' = ANY(reloptions) FROM pg_class WHERE oid = '${q(SCHEMA)}.${q(view)}'::regclass`,
          ),
        ).toBe("t");
      },
    );

    // The deepest tenant paths in the catalogue (hop count from the base relation to the
    // project): each is the most likely place for the barrier to keep the filter above a join.
    // The filter must land on the scan of the relation that carries the project column: the
    // last hop's relation, or the base itself when the path is empty.
    it.each(widest.map((view) => [view.postgres.approvedView, depth(view)] as const))(
      "%s (%i hops): pushdown guard: the TenantId filter is applied on the tenant relation's scan",
      async (name) => {
        const view = widest.find((candidate) => candidate.postgres.approvedView === name) as View;
        const tenantRelation =
          view.postgres.tenantPath?.at(-1)?.relation ?? view.postgres.baseRelation;
        const nodes = await planOf(name);
        const filtered = nodes.filter(
          (node) =>
            /^(Seq Scan|Index Scan|Index Only Scan|Bitmap Heap Scan)$/.test(node["Node Type"]) &&
            node["Relation Name"] === tenantRelation &&
            `${node.Filter ?? ""}${node["Index Cond"] ?? ""}${node["Recheck Cond"] ?? ""}`.includes(
              PROJECT_A,
            ),
        );

        expect(filtered.length).toBeGreaterThan(0);
      },
    );

    it.each(widest.map((view) => view.postgres.approvedView))(
      "%s: pushdown guard: no node above the barrier carries the TenantId filter",
      async (view) => {
        const nodes = await planOf(view);
        const above = nodes.filter(
          (node) =>
            node["Node Type"] === "Subquery Scan" && (node.Filter ?? "").includes(PROJECT_A),
        );

        expect(above).toEqual([]);
      },
    );
  });
});
