/**
 * Per-reader row scoping for LangWatchQL Postgres views, proven on the real generated views.
 *
 * Every view carries `security_barrier=true` and an ANDed predicate on its TenantId source: the
 * shared reader role keeps every row, a login holding an organization role sees only that
 * organization's projects, any other login sees nothing.
 *
 * The describes run in order against one container: the isolation block grants the group schema
 * USAGE by hand (the views run as their owner, so it needs no table grants), the grant block
 * revokes and lets the app re-grant, and the last block removes the group to prove provisioning
 * is unchanged without it.
 *
 * @see ../langwatch-ql-postgres-views.service.ts
 * @see ../langwatch-ql-postgres-mapping.service.ts
 * @vitest-environment node
 */

import { createHash } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  type LangWatchQLPostgresHarness,
  startLangWatchQLPostgres,
  TENANT_A,
  TENANT_B,
} from "../../../../langwatch-ql/__tests__/lwql-clickhouse-harness.ts";
import { LWQL_VIEW_CATALOG } from "../../../../rules/lwql-view-catalog.rules.ts";
import { LangWatchQLCatalogShapesService } from "../../../../services/langwatch-ql-catalog-shapes.service.ts";
import { LangWatchQLProductionProvisioningService } from "../langwatch-ql-production-provisioning.service.ts";
import { LangWatchQLPostgresViewsService } from "../langwatch-ql-postgres-views.service.ts";

const provisioning = LangWatchQLProductionProvisioningService.create();
const postgresViews = LangWatchQLPostgresViewsService.create();
const catalogShapes = LangWatchQLCatalogShapesService.create();

const SCHEMA = "public";
const DATABASE = "lwtest";
const ADMIN = "test";
const PASSWORD = "scope-test-pw";
const SHARED_READER = "lwql_ro";
const GROUP = "lwql_scoped_reader";

const ORG_A = `${TENANT_A.tenantId}-org`;
const ORG_B = `${TENANT_B.tenantId}-org`;
const PROJECT_A = TENANT_A.tenantId;
const PROJECT_B = TENANT_B.tenantId;

const orgRole = (organizationId: string): string =>
  `lwql_org_${createHash("md5").update(organizationId).digest("hex")}`;

const VIEWS = catalogShapes.postgresViews(LWQL_VIEW_CATALOG);
const VIEW_NAMES = postgresViews.approvedViewNames();

type Row = Record<string, unknown> & { TenantId: string };
type RowsByView = Record<string, Row[]>;

describe("given per-reader row scoping over every generated Postgres view", () => {
  let pg: LangWatchQLPostgresHarness;

  const q = (name: string): string => `"${name.replaceAll('"', '""')}"`;

  async function runAs({ user, sql }: { user: string; sql: string }): Promise<string> {
    const result =
      user === ADMIN
        ? await pg.asAdmin(sql)
        : await pg.container.exec(
            ["psql", "-h", "127.0.0.1", "-U", user, "-d", DATABASE, "-v", "ON_ERROR_STOP=1", "-tAc", sql],
            { env: { PGPASSWORD: PASSWORD } },
          );
    if (result.exitCode !== 0) {
      throw new Error(`psql as ${user} failed (${result.exitCode}): ${result.stderr}\n${sql.slice(0, 400)}`);
    }

    return result.stdout.trim();
  }

  const admin = (sql: string) => runAs({ user: ADMIN, sql });

  async function applyAll(statements: string[]): Promise<void> {
    for (const statement of statements) {
      await admin(statement);
    }
  }

  /** The app's own statements: the views, then the shared reader's grants. */
  const provisionViews = () =>
    applyAll([
      ...provisioning.postgresApprovedViewStatements({ schema: SCHEMA, readerRole: SHARED_READER }),
      ...provisioning.postgresReaderGrantStatements({ schema: SCHEMA, role: SHARED_READER }),
    ]);

  /** Every view's full rows, as one login sees them, in one round trip. */
  async function readAllViews(user: string): Promise<RowsByView> {
    const union = VIEW_NAMES.map(
      (name) =>
        `SELECT '${name}' AS n, (SELECT coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) FROM ${q(SCHEMA)}.${q(name)} x) AS r`,
    ).join(" UNION ALL ");

    return JSON.parse(await runAs({ user, sql: `SELECT jsonb_object_agg(n, r) FROM (${union}) s` }));
  }

  /** TenantIds the pre-change views expose, derived from base tables and the catalogue paths. */
  async function baselineTenantIds(): Promise<Record<string, string[]>> {
    const selects = VIEWS.map((view) => {
      const joins = view.postgres.tenantPath ?? [];
      const tenantAlias = joins[joins.length - 1]?.alias ?? "m";
      let previous = "m";
      const joinSql = joins
        .map((hop) => {
          const sql = ` JOIN ${q(SCHEMA)}.${q(hop.relation)} AS ${q(hop.alias)} ON ${q(previous)}.${q(hop.on.from)} = ${q(hop.alias)}.${q(hop.on.to)}`;
          previous = hop.alias;
          return sql;
        })
        .join("");
      const filter = view.postgres.rowFilter?.replaceAll("{{schema}}", q(SCHEMA));
      const inner =
        `SELECT ${q(tenantAlias)}.${q(view.postgres.tenantSourceColumn)} AS "TenantId" ` +
        `FROM ${q(SCHEMA)}.${q(view.postgres.baseRelation)} AS "m"${joinSql}${filter ? ` WHERE (${filter})` : ""}`;

      return `SELECT '${view.postgres.approvedView}' AS n, (SELECT coalesce(jsonb_agg("TenantId"), '[]'::jsonb) FROM (${inner}) q) AS r`;
    }).join(" UNION ALL ");

    const unsorted: Record<string, string[]> = JSON.parse(
      await admin(`SELECT jsonb_object_agg(n, r) FROM (${selects}) s`),
    );

    // Sorted here, not by SQL, so both sides of every comparison share one (JS) ordering.
    return Object.fromEntries(Object.entries(unsorted).map(([view, ids]) => [view, [...ids].sort()]));
  }

  async function projectOrganizations(): Promise<Record<string, string>> {
    const out = await admin(
      `SELECT jsonb_object_agg(p.id, t."organizationId") FROM ${q(SCHEMA)}."Project" p JOIN ${q(SCHEMA)}."Team" t ON t.id = p."teamId"`,
    );

    return JSON.parse(out);
  }

  const canon = (rows: Row[]): string[] => rows.map((row) => JSON.stringify(row)).sort();
  const tenantsOf = (rows: Row[]): string[] => rows.map((row) => row.TenantId).sort();
  const ownedBy = (organizations: Record<string, string>, organizationId: string) => (row: Row) =>
    organizations[row.TenantId] === organizationId;

  let shared: RowsByView;
  let readerA: RowsByView;
  let readerB: RowsByView;
  let ungrouped: RowsByView;
  let baseline: Record<string, string[]>;
  let organizations: Record<string, string>;

  beforeAll(async () => {
    pg = await startLangWatchQLPostgres();
    await admin(`CREATE ROLE ${GROUP} NOLOGIN`);
    await admin(`CREATE ROLE ${SHARED_READER} LOGIN PASSWORD '${PASSWORD}'`);
    for (const org of [ORG_A, ORG_B]) {
      await admin(`CREATE ROLE ${q(orgRole(org))} NOLOGIN`);
    }
    for (const [login, org] of [["reader_a", ORG_A], ["reader_b", ORG_B], ["reader_none", undefined]] as const) {
      await admin(`CREATE ROLE ${login} LOGIN PASSWORD '${PASSWORD}'`);
      await admin(`GRANT ${GROUP} TO ${login} WITH INHERIT TRUE, SET FALSE`);
      if (org) {
        await admin(`GRANT ${q(orgRole(org))} TO ${login} WITH INHERIT FALSE, SET FALSE`);
      }
    }
    await provisionViews();
    // The app's grants name the views; the group reaches only them, never a base table.
    await admin(`GRANT USAGE ON SCHEMA ${SCHEMA} TO ${GROUP}`);

    [shared, readerA, readerB, ungrouped, baseline, organizations] = await Promise.all([
      readAllViews(SHARED_READER),
      readAllViews("reader_a"),
      readAllViews("reader_b"),
      readAllViews("reader_none"),
      baselineTenantIds(),
      projectOrganizations(),
    ]);
  }, 600_000);

  afterAll(async () => {
    await pg?.stop();
  });

  describe("when each approved view is read by each kind of login", () => {
    it.each(VIEW_NAMES)("%s: the shared reader keeps exactly its pre-change TenantIds", (view) => {
      expect(tenantsOf(shared[view] as Row[])).toEqual(baseline[view]);
    });

    it.each(VIEW_NAMES)("%s: an org_a login sees only org_a projects", (view) => {
      const foreign = (readerA[view] as Row[]).filter((row) => organizations[row.TenantId] !== ORG_A);

      expect(foreign).toEqual([]);
    });

    it.each(VIEW_NAMES)("%s: an org_b login sees only org_b projects", (view) => {
      const foreign = (readerB[view] as Row[]).filter((row) => organizations[row.TenantId] !== ORG_B);

      expect(foreign).toEqual([]);
    });

    it.each(VIEW_NAMES)("%s: the org_a login's rows equal the shared rows filtered to org_a", (view) => {
      const expected = (shared[view] as Row[]).filter(ownedBy(organizations, ORG_A));

      expect(canon(readerA[view] as Row[])).toEqual(canon(expected));
    });

    it.each(VIEW_NAMES)("%s: the org_b login's rows equal the shared rows filtered to org_b", (view) => {
      const expected = (shared[view] as Row[]).filter(ownedBy(organizations, ORG_B));

      expect(canon(readerB[view] as Row[])).toEqual(canon(expected));
    });

    it.each(VIEW_NAMES)("%s: a group member with no org role sees no rows", (view) => {
      expect(ungrouped[view]).toEqual([]);
    });
  });

  describe("when the seed is checked against vacuous passes", () => {
    // Every rowFilter view (boards, widgets, the Langy tables) is seeded visible for both orgs.
    it.each(VIEW_NAMES)(
      "%s: the shared baseline has rows for both orgs",
      (view) => {
        const rows = shared[view] as Row[];

        expect([rows.some(ownedBy(organizations, ORG_A)), rows.some(ownedBy(organizations, ORG_B))]).toEqual([
          true,
          true,
        ]);
      },
    );
  });

  describe("when a project moves to another organization's team", () => {
    let movedA: RowsByView;
    let movedB: RowsByView;
    let movedOrganizations: Record<string, string>;

    beforeAll(async () => {
      const teamB = await admin(`SELECT "teamId" FROM ${q(SCHEMA)}."Project" WHERE id = '${PROJECT_B}'`);
      const teamA = await admin(`SELECT "teamId" FROM ${q(SCHEMA)}."Project" WHERE id = '${PROJECT_A}'`);
      await admin(`UPDATE ${q(SCHEMA)}."Project" SET "teamId" = '${teamB}' WHERE id = '${PROJECT_A}'`);
      try {
        [movedA, movedB, movedOrganizations] = await Promise.all([
          readAllViews("reader_a"),
          readAllViews("reader_b"),
          projectOrganizations(),
        ]);
      } finally {
        await admin(`UPDATE ${q(SCHEMA)}."Project" SET "teamId" = '${teamA}' WHERE id = '${PROJECT_A}'`);
      }
    });

    it("the project now belongs to org_b", () => {
      expect(movedOrganizations[PROJECT_A]).toBe(ORG_B);
    });

    it.each(VIEW_NAMES)("%s: the org_a login no longer sees the moved project", (view) => {
      expect(tenantsOf(movedA[view] as Row[])).not.toContain(PROJECT_A);
    });

    it.each(VIEW_NAMES)("%s: the org_b login sees every row it saw before", (view) => {
      const after = new Set(canon(movedB[view] as Row[]));
      const missing = canon(readerB[view] as Row[]).filter((row) => !after.has(row));

      expect(missing).toEqual([]);
    });

    it("an annotation-style project-path view moves the project's rows to the org_b login", () => {
      const projectPathView = VIEWS.find(
        (view) => (view.postgres.tenantPath ?? []).length === 0 && (shared[view.postgres.approvedView] as Row[]).some((r) => r.TenantId === PROJECT_A),
      );
      const rows = movedB[projectPathView?.postgres.approvedView ?? ""] as Row[] | undefined;

      expect(rows?.some((row) => row.TenantId === PROJECT_A)).toBe(true);
    });
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
    const depth = (view: (typeof VIEWS)[number]): number => view.postgres.tenantPath?.length ?? 0;
    const widest = [...VIEWS].sort((a, b) => depth(b) - depth(a) || a.postgres.approvedView.localeCompare(b.postgres.approvedView)).slice(0, 3);

    type PlanNode = {
      "Node Type": string;
      "Relation Name"?: string;
      Filter?: string;
      "Index Cond"?: string;
      "Recheck Cond"?: string;
      Plans?: PlanNode[];
    };
    const flatten = (node: PlanNode): PlanNode[] => [node, ...(node.Plans ?? []).flatMap(flatten)];
    const planOf = async (view: string): Promise<PlanNode[]> => {
      const out = await runAs({
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
    it.each(widest.map((view) => view.postgres.approvedView))("%s: is a barrier view", async (view) => {
      expect(
        await admin(`SELECT 'security_barrier=true' = ANY(reloptions) FROM pg_class WHERE oid = '${q(SCHEMA)}.${q(view)}'::regclass`),
      ).toBe("t");
    });

    // The deepest tenant paths in the catalogue (hop count from the base relation to the
    // project): each is the most likely place for the barrier to keep the filter above a join.
    // The filter must land on the scan of the relation that carries the project column: the
    // last hop's relation, or the base itself when the path is empty.
    it.each(widest.map((view) => [view.postgres.approvedView, depth(view)] as const))(
      "%s (%i hops): pushdown guard: the TenantId filter is applied on the tenant relation's scan",
      async (name) => {
        const view = widest.find((candidate) => candidate.postgres.approvedView === name) as (typeof VIEWS)[number];
        const tenantRelation = view.postgres.tenantPath?.at(-1)?.relation ?? view.postgres.baseRelation;
        const nodes = await planOf(name);
        const filtered = nodes.filter(
          (node) =>
            /^(Seq Scan|Index Scan|Index Only Scan|Bitmap Heap Scan)$/.test(node["Node Type"]) &&
            node["Relation Name"] === tenantRelation &&
            `${node.Filter ?? ""}${node["Index Cond"] ?? ""}${node["Recheck Cond"] ?? ""}`.includes(PROJECT_A),
        );

        expect(filtered.length).toBeGreaterThan(0);
      },
    );

    it.each(widest.map((view) => view.postgres.approvedView))(
      "%s: pushdown guard: no node above the barrier carries the TenantId filter",
      async (view) => {
        const nodes = await planOf(view);
        const above = nodes.filter((node) => node["Node Type"] === "Subquery Scan" && (node.Filter ?? "").includes(PROJECT_A));

        expect(above).toEqual([]);
      },
    );
  });

  describe("when the app provisions after the group lost its view grants", () => {
    beforeAll(async () => {
      await admin(`REVOKE ALL ON ALL TABLES IN SCHEMA ${SCHEMA} FROM ${GROUP}`);
      await provisionViews();
    });

    it("the group has SELECT on every view", async () => {
      const missing = await admin(
        `SELECT coalesce(string_agg(v, ','), '') FROM unnest(ARRAY[${VIEW_NAMES.map((n) => `'${n}'`).join(",")}]) v WHERE NOT has_table_privilege('${GROUP}', format('%I.%I', '${SCHEMA}', v), 'SELECT')`,
      );

      expect(missing).toBe("");
    });
  });

  describe("when a view takes the drop-and-create fallback", () => {
    const view = VIEW_NAMES[0] as string;

    beforeAll(async () => {
      await admin(`DROP VIEW ${q(SCHEMA)}.${q(view)}`);
      await admin(`CREATE VIEW ${q(SCHEMA)}.${q(view)} AS SELECT 1 AS bogus_column`);
      const statements = provisioning.postgresApprovedViewStatements({ schema: SCHEMA, readerRole: SHARED_READER });
      await admin(statements[0] as string);
    });

    it("the group has SELECT on the recreated view", async () => {
      expect(await admin(`SELECT has_table_privilege('${GROUP}', '${q(SCHEMA)}.${q(view)}', 'SELECT')`)).toBe("t");
    });

    it("the recreated view has security_barrier=true", async () => {
      expect(
        await admin(`SELECT 'security_barrier=true' = ANY(reloptions) FROM pg_class WHERE oid = '${q(SCHEMA)}.${q(view)}'::regclass`),
      ).toBe("t");
    });
  });

  describe("when a stale unscoped view exists and a gap run grants the scoped-reader group", () => {
    const stale = VIEW_NAMES[0] as string;
    const scoped = VIEW_NAMES[1] as string;

    beforeAll(async () => {
      // Start from no grants, so the scoped view's SELECT below can only come from the gap run.
      await admin(`REVOKE ALL ON ALL TABLES IN SCHEMA ${SCHEMA} FROM ${GROUP}`);
      // Not recreated by the app: only the gap run's guarded statements touch it. The group
      // already holds SELECT on it, as after an earlier scoped run, so the run must revoke it.
      await admin(`DROP VIEW ${q(SCHEMA)}.${q(stale)}`);
      await admin(`CREATE VIEW ${q(SCHEMA)}.${q(stale)} AS SELECT 1 AS bogus_column`);
      await admin(`GRANT SELECT ON ${q(SCHEMA)}.${q(stale)} TO ${GROUP}`);
      await applyAll(provisioning.postgresReaderGrantStatements({ schema: SCHEMA, role: SHARED_READER }));
    });

    const canSelect = (view: string) =>
      admin(`SELECT has_table_privilege('${GROUP}', '${q(SCHEMA)}.${q(view)}', 'SELECT')`);

    it("the group has no SELECT on the unscoped view, a stale grant included", async () => {
      expect(await canSelect(stale)).toBe("f");
    });

    it("the group still has SELECT on a scoped view", async () => {
      expect(await canSelect(scoped)).toBe("t");
    });
  });

  describe("when look-alike views carry the org-role lookup but no membership tie to the session user", () => {
    const [withoutMembership, withoutSessionTie] = [VIEW_NAMES[2] as string, VIEW_NAMES[3] as string];
    const lookup = "g.rolname = 'lwql_org_'::text || md5('x')";

    beforeAll(async () => {
      await admin(`REVOKE ALL ON ALL TABLES IN SCHEMA ${SCHEMA} FROM ${GROUP}`);
      // Security barrier and the org-role fragment, but nothing ties the lookup to who is asking.
      const decoys: Record<string, string> = {
        [withoutMembership]: `EXISTS (SELECT 1 FROM pg_roles g WHERE ${lookup})`,
        [withoutSessionTie]: `EXISTS (SELECT 1 FROM pg_roles g JOIN pg_auth_members m ON m.roleid = g.oid WHERE ${lookup})`,
      };
      for (const [view, predicate] of Object.entries(decoys)) {
        await admin(`DROP VIEW ${q(SCHEMA)}.${q(view)}`);
        await admin(
          `CREATE VIEW ${q(SCHEMA)}.${q(view)} WITH (security_barrier = true) AS SELECT 1 AS bogus_column WHERE ${predicate}`,
        );
        await admin(`GRANT SELECT ON ${q(SCHEMA)}.${q(view)} TO ${GROUP}`);
      }
      await applyAll(provisioning.postgresReaderGrantStatements({ schema: SCHEMA, role: SHARED_READER }));
    });

    const canSelect = (view: string) =>
      admin(`SELECT has_table_privilege('${GROUP}', '${q(SCHEMA)}.${q(view)}', 'SELECT')`);

    it("the group has no SELECT on a view with no membership join, a stale grant included", async () => {
      expect(await canSelect(withoutMembership)).toBe("f");
    });

    it("the group has no SELECT on a view with a membership join but no session-user comparison", async () => {
      expect(await canSelect(withoutSessionTie)).toBe("f");
    });

    it("the group still has SELECT on a scoped view", async () => {
      expect(await canSelect(VIEW_NAMES[4] as string)).toBe("t");
    });
  });

  describe("when the group role does not exist", () => {
    let outcome: "ok" | Error = "ok";

    beforeAll(async () => {
      await admin(`DROP OWNED BY ${GROUP}`);
      await admin(`DROP ROLE ${GROUP}`);
      try {
        await provisionViews();
      } catch (error) {
        outcome = error as Error;
      }
    });

    it("provisioning succeeds unchanged", () => {
      expect(outcome).toBe("ok");
    });

    it("the group role is not created", async () => {
      expect(await admin(`SELECT count(*) FROM pg_roles WHERE rolname = '${GROUP}'`)).toBe("0");
    });

    it("the shared reader still reads every view", async () => {
      const after = await readAllViews(SHARED_READER);

      expect(Object.keys(after).sort()).toEqual([...VIEW_NAMES].sort());
    });
  });
});
