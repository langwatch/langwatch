/**
 * The scoped-reader group's grants over live copies: re-granted after a loss, re-granted on the
 * drop-and-create fallback, never held on a copy that is not row-scoped, and never on the app's.
 * @see ../langwatch-ql-production-provisioning.service.ts
 * @vitest-environment node
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { convergeLwqlAccessModel } from "../../../../tasks/lwql-provision.task.ts";
import { LWQL_PROJECT_KEYS_VIEW } from "../../rules/lwql-scoped-view.rules.ts";
import type { LwqlPostgresGap } from "../langwatch-ql-postgres-gaps.service.ts";
import {
  ADMIN,
  deployStatements,
  GROUP,
  postgresOnlyPlan,
  provisioning,
  q,
  readPostgresGaps,
  SCHEMA,
  SCOPED,
  type ScopeHarness,
  SHARED_READER,
  startScopeHarness,
  VIEW_NAMES,
} from "./langwatch-ql-postgres-reader-scope.fixtures.ts";

/** Provisioning every view takes over a minute on a shared CI runner. */
const PROVISION_HOOK_TIMEOUT_MS = 300_000;

describe("given the scoped-reader group and the app's view provisioning", () => {
  let harness: ScopeHarness;
  const admin = (sql: string) => harness.admin(sql);
  const revokeAll = () => admin(`REVOKE ALL ON ALL TABLES IN SCHEMA ${SCOPED} FROM ${GROUP}`);
  const copy = (view: string) => `${q(SCOPED)}.${q(view)}`;
  const canSelect = (view: string) =>
    admin(`SELECT has_table_privilege('${GROUP}', '${copy(view)}', 'SELECT')`);
  const grantAsApp = () =>
    harness.applyAll(provisioning.postgresScopedReaderGrantStatements({ schema: SCHEMA }));
  const replaceWithLookAlike = async (view: string, body = "SELECT 1 AS bogus_column") => {
    await admin(`DROP VIEW ${copy(view)}`);
    await admin(`CREATE VIEW ${copy(view)} AS ${body}`);
  };

  beforeAll(async () => {
    harness = await startScopeHarness();
  }, 600_000);

  afterAll(async () => {
    await harness?.stop();
  });

  describe("when the app provisions after the group lost its copy grants", () => {
    beforeAll(async () => {
      await harness.provisionViews();
      await revokeAll();
      await harness.provisionViews();
    }, PROVISION_HOOK_TIMEOUT_MS);

    it("the group has SELECT on every copy", async () => {
      const missing = await admin(
        `SELECT coalesce(string_agg(v, ','), '') FROM unnest(ARRAY[${VIEW_NAMES.map((n) => `'${n}'`).join(",")}]) v WHERE NOT has_table_privilege('${GROUP}', format('%I.%I', '${SCOPED}', v), 'SELECT')`,
      );

      expect(missing).toBe("");
    });

    it("the group has USAGE on the scoped schema and none on the app schema", async () => {
      expect(await harness.directSchemaUsage(GROUP)).toEqual([SCOPED]);
    });
  });

  describe("when a copy takes the drop-and-create fallback", () => {
    const view = VIEW_NAMES[0] as string;

    beforeAll(async () => {
      await harness.provisionViews();
      await replaceWithLookAlike(view);
      const [statement] = provisioning
        .postgresScopedViewStatements({ schema: SCHEMA })
        .filter((candidate) => candidate.includes(copy(view)));
      await admin(statement as string);
    }, PROVISION_HOOK_TIMEOUT_MS);

    it("the group has SELECT on the recreated copy", async () => {
      expect(await canSelect(view)).toBe("t");
    });

    it("the recreated copy has security_barrier=true", async () => {
      expect(
        await admin(
          `SELECT 'security_barrier=true' = ANY(reloptions) FROM pg_class WHERE oid = '${copy(view)}'::regclass`,
        ),
      ).toBe("t");
    });
  });

  describe("when a stale unscoped copy exists and the app grants the scoped-reader group", () => {
    const stale = VIEW_NAMES[0] as string;
    const scoped = VIEW_NAMES[1] as string;

    beforeAll(async () => {
      await harness.provisionViews();
      // Start from no grants, so the scoped copy's SELECT below can only come from the grant run.
      await revokeAll();
      // The group already holds SELECT on the look-alike, as after an earlier scoped run.
      await replaceWithLookAlike(stale);
      await admin(`GRANT SELECT ON ${copy(stale)} TO ${GROUP}`);
      await grantAsApp();
    }, PROVISION_HOOK_TIMEOUT_MS);

    /** @scenario "The scoped-reader group is granted only a live view that is provably row-scoped" */
    it("the group has no SELECT on the unscoped copy, a stale grant included", async () => {
      expect(await canSelect(stale)).toBe("f");
    });

    it("the group still has SELECT on a scoped copy", async () => {
      expect(await canSelect(scoped)).toBe("t");
    });
  });

  describe("when a look-alike replaces a granted copy and a deploy restores it", () => {
    const view = VIEW_NAMES[0] as string;
    let afterGrant: string;
    let afterReplace: string;

    beforeAll(async () => {
      await harness.provisionViews();
      afterGrant = await canSelect(view);
      await replaceWithLookAlike(view);
      await admin(`GRANT SELECT ON ${copy(view)} TO ${GROUP}`);
      await grantAsApp();
      afterReplace = await canSelect(view);
      // No manual step: the deploy's own statements recreate the copy and re-grant it.
      await harness.applyAll(deployStatements());
    }, PROVISION_HOOK_TIMEOUT_MS);

    it("the group has SELECT on the scoped copy first", () => {
      expect(afterGrant).toBe("t");
    });

    it("the group loses SELECT on the unscoped look-alike", () => {
      expect(afterReplace).toBe("f");
    });

    /** @scenario "A scoped view a deploy converge restores regains the scoped-reader group's SELECT" */
    it("the group has SELECT again once the deploy converge restores the scoped copy", async () => {
      expect(await canSelect(view)).toBe("t");
    });
  });

  describe("when look-alike copies carry the org-role lookup but no membership tie to the current user", () => {
    const withoutMembership = VIEW_NAMES[2] as string;
    const withoutCurrentUserTie = VIEW_NAMES[3] as string;
    const lookup = "g.rolname = 'lwql_org_'::text || md5('x')";

    beforeAll(async () => {
      await harness.provisionViews();
      await revokeAll();
      // Security barrier and the org-role fragment, but nothing ties the lookup to who is asking.
      const decoys: Record<string, string> = {
        [withoutMembership]: `EXISTS (SELECT 1 FROM pg_roles g WHERE ${lookup})`,
        [withoutCurrentUserTie]: `EXISTS (SELECT 1 FROM pg_roles g JOIN pg_auth_members m ON m.roleid = g.oid WHERE ${lookup})`,
      };
      for (const [view, predicate] of Object.entries(decoys)) {
        await admin(`DROP VIEW ${copy(view)}`);
        await admin(
          `CREATE VIEW ${copy(view)} WITH (security_barrier = true) AS SELECT 1 AS bogus_column WHERE ${predicate}`,
        );
        await admin(`GRANT SELECT ON ${copy(view)} TO ${GROUP}`);
      }
      await grantAsApp();
    }, PROVISION_HOOK_TIMEOUT_MS);

    /** @scenario "The scoped-reader group is granted only a live view that is provably row-scoped" */
    it("the group has no SELECT on a copy with no membership join, a stale grant included", async () => {
      expect(await canSelect(withoutMembership)).toBe("f");
    });

    it("the group has no SELECT on a copy with a membership join but no current-user comparison", async () => {
      expect(await canSelect(withoutCurrentUserTie)).toBe("f");
    });

    it("the group still has SELECT on a scoped copy", async () => {
      expect(await canSelect(VIEW_NAMES[4] as string)).toBe("t");
    });
  });

  describe("when the group holds a stale grant on a shared view and USAGE on the app schema", () => {
    const shared = `${q(SCHEMA)}.${q(VIEW_NAMES[0] as string)}`;
    const staleGrants = async () => {
      await admin(`GRANT USAGE ON SCHEMA ${q(SCHEMA)} TO ${GROUP}`);
      await admin(`GRANT SELECT ON ${shared} TO ${GROUP}`);
    };
    const reach = async () => {
      const onShared = await admin(`SELECT has_table_privilege('${GROUP}', '${shared}', 'SELECT')`);
      const onAppSchema = (await harness.directSchemaUsage(GROUP)).includes(SCHEMA);
      return `${onShared === "t"},${onAppSchema}`;
    };
    let afterDeploy: string;
    let gapsFound: LwqlPostgresGap[];
    let afterCheck: string;

    beforeAll(async () => {
      await harness.provisionViews();
      await staleGrants();
      await harness.applyAll(deployStatements());
      afterDeploy = await reach();
      await staleGrants();
      const connection = harness.connect(ADMIN);
      try {
        gapsFound = await readPostgresGaps(connection.database);
        await convergeLwqlAccessModel({
          database: connection.database,
          plan: postgresOnlyPlan(),
          failOnError: true,
          only: { clickHouse: [], postgres: gapsFound, isKeyMapMissing: false },
        });
      } finally {
        await connection.close();
      }
      afterCheck = await reach();
    }, PROVISION_HOOK_TIMEOUT_MS);

    /** @scenario "The reconvergence check guards every scoped copy" */
    it("a deploy revokes both", () => {
      expect(afterDeploy).toBe("false,false");
    });

    it("the reconvergence check finds the shared grant", () => {
      expect(gapsFound).toContainEqual({ kind: "group-on-shared", view: VIEW_NAMES[0] });
    });

    /** @scenario "The reconvergence check guards every scoped copy" */
    it("the reconvergence check's converge revokes both", () => {
      expect(afterCheck).toBe("false,false");
    });
  });
});

/**
 * Provisioning without the scoped-reader group is unchanged: no error, no group, no scoped schema,
 * and the shared reader still reads every view. Once the group exists, a check builds the copies.
 * @see ../langwatch-ql-production-provisioning.service.ts
 */
describe("given a deployment where the scoped-reader group does not exist", () => {
  let harness: ScopeHarness;
  let outcome: "ok" | Error = "ok";

  beforeAll(async () => {
    harness = await startScopeHarness({ provision: false });
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
    /** @scenario "Provisioning without the scoped-reader group is unchanged" */
    it("provisioning succeeds unchanged", () => {
      expect(outcome).toBe("ok");
    });

    it("the group role is not created", async () => {
      expect(await harness.admin(`SELECT count(*) FROM pg_roles WHERE rolname = '${GROUP}'`)).toBe(
        "0",
      );
    });

    /** @scenario "Scoped copies exist only where the scoped-reader group does" */
    it("no scoped schema exists", async () => {
      expect(await harness.admin(`SELECT to_regnamespace('${SCOPED}') IS NULL`)).toBe("t");
    });

    it("the shared reader still reads every view", async () => {
      const after = await harness.readAllViews({ user: SHARED_READER, schema: SCHEMA });

      expect(Object.keys(after).toSorted()).toEqual(VIEW_NAMES.toSorted());
    });

    /** @scenario "Scoped copies exist only where the scoped-reader group does" */
    it("the reconvergence check reports no gap", async () => {
      const connection = harness.connect(ADMIN);
      try {
        expect(await readPostgresGaps(connection.database)).toEqual([]);
      } finally {
        await connection.close();
      }
    });
  });

  describe("when the group is created and the next reconvergence check runs", () => {
    let gapsFound: LwqlPostgresGap[];

    beforeAll(async () => {
      await harness.admin(`CREATE ROLE ${GROUP} NOLOGIN`);
      const connection = harness.connect(ADMIN);
      try {
        gapsFound = await readPostgresGaps(connection.database);
        await convergeLwqlAccessModel({
          database: connection.database,
          plan: postgresOnlyPlan(),
          failOnError: true,
          only: { clickHouse: [], postgres: gapsFound, isKeyMapMissing: false },
        });
      } finally {
        await connection.close();
      }
    }, PROVISION_HOOK_TIMEOUT_MS);

    it("the check finds the scoped schema absent", () => {
      expect(gapsFound).toEqual([{ kind: "scoped-schema-absent" }]);
    });

    /** @scenario "Scoped copies exist only where the scoped-reader group does" */
    it("every copy exists and the group selects exactly the copies", async () => {
      // The project-keys copy is granted with them; it is not an approved dataset view.
      expect((await harness.selectableBy(GROUP)).toSorted()).toEqual(
        [...VIEW_NAMES, LWQL_PROJECT_KEYS_VIEW].map((view) => `${SCOPED}.${view}`).toSorted(),
      );
    });

    /** @scenario "Scoped copies exist only where the scoped-reader group does" */
    it("the group has USAGE on the scoped schema only", async () => {
      expect(await harness.directSchemaUsage(GROUP)).toEqual([SCOPED]);
    });
  });
});
