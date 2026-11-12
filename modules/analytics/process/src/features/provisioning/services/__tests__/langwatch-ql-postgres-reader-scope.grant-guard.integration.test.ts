/**
 * The scoped-reader group's grants over live views: re-granted after a loss, re-granted on the
 * drop-and-create fallback, and never held on a view that is not the row-scoped one.
 * @see ../langwatch-ql-production-provisioning.service.ts
 * @vitest-environment node
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  GROUP,
  provisioning,
  q,
  SCHEMA,
  type ScopeHarness,
  SHARED_READER,
  startScopeHarness,
  VIEW_NAMES,
} from "./langwatch-ql-postgres-reader-scope.fixtures.ts";

describe("given the scoped-reader group and the app's view provisioning", () => {
  let harness: ScopeHarness;
  const admin = (sql: string) => harness.admin(sql);
  const revokeAll = () => admin(`REVOKE ALL ON ALL TABLES IN SCHEMA ${SCHEMA} FROM ${GROUP}`);
  const canSelect = (view: string) =>
    admin(`SELECT has_table_privilege('${GROUP}', '${q(SCHEMA)}.${q(view)}', 'SELECT')`);
  const grantAsApp = () =>
    harness.applyAll(
      provisioning.postgresReaderGrantStatements({ schema: SCHEMA, role: SHARED_READER }),
    );

  beforeAll(async () => {
    harness = await startScopeHarness();
  }, 600_000);

  afterAll(async () => {
    await harness?.stop();
  });

  describe("when the app provisions after the group lost its view grants", () => {
    beforeAll(async () => {
      await harness.provisionViews();
      await revokeAll();
      await harness.provisionViews();
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
      await harness.provisionViews();
      await admin(`DROP VIEW ${q(SCHEMA)}.${q(view)}`);
      await admin(`CREATE VIEW ${q(SCHEMA)}.${q(view)} AS SELECT 1 AS bogus_column`);
      const statements = provisioning.postgresApprovedViewStatements({
        schema: SCHEMA,
        readerRole: SHARED_READER,
      });
      await admin(statements[0] as string);
    });

    it("the group has SELECT on the recreated view", async () => {
      expect(await canSelect(view)).toBe("t");
    });

    it("the recreated view has security_barrier=true", async () => {
      expect(
        await admin(
          `SELECT 'security_barrier=true' = ANY(reloptions) FROM pg_class WHERE oid = '${q(SCHEMA)}.${q(view)}'::regclass`,
        ),
      ).toBe("t");
    });
  });

  describe("when a stale unscoped view exists and a gap run grants the scoped-reader group", () => {
    const stale = VIEW_NAMES[0] as string;
    const scoped = VIEW_NAMES[1] as string;

    beforeAll(async () => {
      await harness.provisionViews();
      // Start from no grants, so the scoped view's SELECT below can only come from the gap run.
      await revokeAll();
      // Not recreated by the app: only the gap run's guarded statements touch it. The group
      // already holds SELECT on it, as after an earlier scoped run, so the run must revoke it.
      await admin(`DROP VIEW ${q(SCHEMA)}.${q(stale)}`);
      await admin(`CREATE VIEW ${q(SCHEMA)}.${q(stale)} AS SELECT 1 AS bogus_column`);
      await admin(`GRANT SELECT ON ${q(SCHEMA)}.${q(stale)} TO ${GROUP}`);
      await grantAsApp();
    });

    it("the group has no SELECT on the unscoped view, a stale grant included", async () => {
      expect(await canSelect(stale)).toBe("f");
    });

    it("the group still has SELECT on a scoped view", async () => {
      expect(await canSelect(scoped)).toBe("t");
    });
  });

  /** @scenario "A scoped view a deploy converge restores regains the scoped-reader group's SELECT" */
  describe("when a look-alike replaces a granted view and a deploy restores it", () => {
    const view = VIEW_NAMES[0] as string;
    const deployConverge = () =>
      harness.applyAll([
        ...provisioning.postgresApprovedViewStatements({
          schema: SCHEMA,
          readerRole: SHARED_READER,
        }),
        ...provisioning.postgresReaderGrantStatements({ schema: SCHEMA, role: SHARED_READER }),
        ...provisioning.postgresScopedReaderGrantStatements({ schema: SCHEMA }),
      ]);
    let afterGrant: string;
    let afterReplace: string;

    beforeAll(async () => {
      await harness.provisionViews();
      afterGrant = await canSelect(view);
      await admin(`DROP VIEW ${q(SCHEMA)}.${q(view)}`);
      await admin(`CREATE VIEW ${q(SCHEMA)}.${q(view)} AS SELECT 1 AS bogus_column`);
      await admin(`GRANT SELECT ON ${q(SCHEMA)}.${q(view)} TO ${GROUP}`);
      await grantAsApp();
      afterReplace = await canSelect(view);
      // No manual step: the deploy's own statements recreate the scoped view and re-grant it.
      await deployConverge();
    });

    it("the group has SELECT on the scoped view first", () => {
      expect(afterGrant).toBe("t");
    });

    it("the group loses SELECT on the unscoped look-alike", () => {
      expect(afterReplace).toBe("f");
    });

    it("the group has SELECT again once the deploy converge restores the scoped view", async () => {
      expect(await canSelect(view)).toBe("t");
    });
  });

  describe("when look-alike views carry the org-role lookup but no membership tie to the session user", () => {
    const withoutMembership = VIEW_NAMES[2] as string;
    const withoutSessionTie = VIEW_NAMES[3] as string;
    const lookup = "g.rolname = 'lwql_org_'::text || md5('x')";

    beforeAll(async () => {
      await harness.provisionViews();
      await revokeAll();
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
      await grantAsApp();
    });

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
});

/**
 * Provisioning without the scoped-reader group is unchanged: no error, no group created, and
 * the shared reader still reads every view.
 * @see ../langwatch-ql-production-provisioning.service.ts
 */
describe("given a deployment where the scoped-reader group does not exist", () => {
  let harness: ScopeHarness;
  let outcome: "ok" | Error = "ok";

  beforeAll(async () => {
    harness = await startScopeHarness();
    await harness.admin(`DROP OWNED BY ${GROUP}`);
    await harness.admin(`DROP ROLE ${GROUP}`);
    try {
      await harness.provisionViews();
    } catch (error) {
      outcome = error as Error;
    }
  }, 600_000);

  afterAll(async () => {
    await harness?.stop();
  });

  describe("when the app provisions the views", () => {
    it("provisioning succeeds unchanged", () => {
      expect(outcome).toBe("ok");
    });

    it("the group role is not created", async () => {
      expect(await harness.admin(`SELECT count(*) FROM pg_roles WHERE rolname = '${GROUP}'`)).toBe(
        "0",
      );
    });

    it("the shared reader still reads every view", async () => {
      const after = await harness.readAllViews(SHARED_READER);

      expect(Object.keys(after).toSorted()).toEqual(VIEW_NAMES.toSorted());
    });
  });
});
