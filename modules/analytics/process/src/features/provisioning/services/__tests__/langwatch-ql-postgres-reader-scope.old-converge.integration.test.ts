/**
 * An older version's converge, its drop-and-create fallback included, run after the scoped setup:
 * it rewrites only the shared views, so no scoped copy is unscoped and the group reaches nothing
 * else.
 * @see ../langwatch-ql-production-provisioning.service.ts
 * @vitest-environment node
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  canon,
  GROUP,
  ORG_A,
  ownedBy,
  q,
  READER_A,
  type Row,
  type RowsByView,
  SCHEMA,
  SCOPED,
  type ScopeHarness,
  SHARED_READER,
  startScopeHarness,
  VIEW_NAMES,
} from "./langwatch-ql-postgres-reader-scope.fixtures.ts";

describe("given the scoped copies and the group's grants on them", () => {
  let harness: ScopeHarness;
  let before: string;
  let after: string;
  let replaced: string;
  let unscoped: string[];
  let shared: RowsByView;
  let readerA: RowsByView;
  let organizations: Record<string, string>;

  const columnsOf = async ({ schema, view }: { schema: string; view: string }) =>
    (
      await harness.admin(
        `SELECT string_agg(column_name::text, ',' ORDER BY ordinal_position) ` +
          `FROM information_schema.columns ` +
          `WHERE table_schema = '${schema}' AND table_name = '${view.replaceAll("'", "''")}'`,
      )
    )
      .split(",")
      .filter(Boolean);

  beforeAll(async () => {
    harness = await startScopeHarness();
    before = await harness.scopedCopyDefinitions();
    replaced = await harness.applyOlderConverge();
    after = await harness.scopedCopyDefinitions();
    unscoped = await harness.unscopedSelectable(GROUP);
    [shared, readerA, organizations] = await Promise.all([
      harness.readAllViews({ user: SHARED_READER, schema: SCHEMA }),
      harness.readAllViews({ user: READER_A, schema: SCOPED }),
      harness.projectOrganizations(),
    ]);
  }, 600_000);

  afterAll(async () => {
    await harness?.stop();
  });

  describe("when an older version's converge rewrites the shared views, its fallback included", () => {
    it("took the drop-and-create fallback on the look-alike shared view", async () => {
      const columns = await harness.admin(
        `SELECT count(*) FROM information_schema.columns ` +
          `WHERE table_schema = '${SCHEMA}' AND table_name = '${replaced}' ` +
          `AND column_name = 'bogus_column'`,
      );

      expect(columns).toBe("0");
    });

    it("leaves a copy of every approved view in the scoped schema", () => {
      expect(Object.keys(JSON.parse(before)).toSorted()).toEqual(VIEW_NAMES.toSorted());
    });

    /** @scenario "An older version's converge cannot weaken a scoped copy" */
    it("leaves every copy's stored definition and options byte-equal", () => {
      expect(after).toBe(before);
    });

    /** @scenario "An older version's converge cannot weaken a scoped copy" */
    it("leaves the group no relation outside the copies that pass the scoped-view check", () => {
      expect(unscoped).toEqual([]);
    });

    it("refuses an organization login a shared view", async () => {
      await expect(
        harness.runAs({
          user: READER_A,
          sql: `SELECT count(*) FROM ${q(SCHEMA)}.${q(VIEW_NAMES[1] as string)}`,
        }),
      ).rejects.toThrow(/permission denied/);
    });

    /** @scenario "An older version's converge cannot weaken a scoped copy" */
    it.each(VIEW_NAMES)(
      "%s: the org_a login's copy rows equal the shared rows filtered to org_a",
      async (view) => {
        const sharedColumns = await columnsOf({ schema: SCHEMA, view });
        const copyColumns = await columnsOf({ schema: SCOPED, view });
        // The frozen older converge leaves shared views without columns the current copy adds, so
        // the copy must cover the shared columns and is compared on those alone.
        const missing = sharedColumns.filter((column) => !copyColumns.includes(column));
        const project = (row: Row): Row =>
          Object.fromEntries(sharedColumns.map((column) => [column, row[column]])) as Row;
        const expected = (shared[view] as Row[]).filter(ownedBy(organizations, ORG_A));

        expect(sharedColumns.length).toBeGreaterThan(0);
        expect(missing).toEqual([]);
        expect(canon((readerA[view] as Row[]).map(project))).toEqual(canon(expected.map(project)));
      },
    );
  });
});
