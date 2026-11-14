/**
 * Row isolation per approved view: the shared reader keeps every row, an org-role login sees
 * only its organization's projects.
 * @see ../langwatch-ql-postgres-views.service.ts
 * @vitest-environment node
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  canon,
  ORG_A,
  ORG_B,
  ownedBy,
  READER_A,
  READER_B,
  type Row,
  type RowsByView,
  type ScopeHarness,
  SHARED_READER,
  startScopeHarness,
  tenantsOf,
  VIEW_NAMES,
} from "./langwatch-ql-postgres-reader-scope.fixtures.ts";

describe("given per-reader row scoping over every generated Postgres view", () => {
  let harness: ScopeHarness;
  let shared: RowsByView;
  let readerA: RowsByView;
  let readerB: RowsByView;
  let baseline: Record<string, string[]>;
  let organizations: Record<string, string>;

  beforeAll(async () => {
    harness = await startScopeHarness();
    [shared, readerA, readerB, baseline, organizations] = await Promise.all([
      harness.readAllViews(SHARED_READER),
      harness.readAllViews(READER_A),
      harness.readAllViews(READER_B),
      harness.baselineTenantIds(),
      harness.projectOrganizations(),
    ]);
  }, 600_000);

  afterAll(async () => {
    await harness?.stop();
  });

  describe("when each approved view is read by each kind of login", () => {
    it.each(VIEW_NAMES)("%s: the shared reader keeps exactly its pre-change TenantIds", (view) => {
      expect(tenantsOf(shared[view] as Row[])).toEqual(baseline[view]);
    });

    it.each(VIEW_NAMES)("%s: an org_a login sees only org_a projects", (view) => {
      const foreign = (readerA[view] as Row[]).filter(
        (row) => organizations[row.TenantId] !== ORG_A,
      );

      expect(foreign).toEqual([]);
    });

    it.each(VIEW_NAMES)("%s: an org_b login sees only org_b projects", (view) => {
      const foreign = (readerB[view] as Row[]).filter(
        (row) => organizations[row.TenantId] !== ORG_B,
      );

      expect(foreign).toEqual([]);
    });

    it.each(VIEW_NAMES)(
      "%s: the org_a login's rows equal the shared rows filtered to org_a",
      (view) => {
        const expected = (shared[view] as Row[]).filter(ownedBy(organizations, ORG_A));

        expect(canon(readerA[view] as Row[])).toEqual(canon(expected));
      },
    );

    it.each(VIEW_NAMES)(
      "%s: the org_b login's rows equal the shared rows filtered to org_b",
      (view) => {
        const expected = (shared[view] as Row[]).filter(ownedBy(organizations, ORG_B));

        expect(canon(readerB[view] as Row[])).toEqual(canon(expected));
      },
    );
  });

  describe("when the seed is checked against vacuous passes", () => {
    // Every rowFilter view (boards, widgets, the Langy tables) is seeded visible for both orgs.
    it.each(VIEW_NAMES)("%s: the shared baseline has rows for both orgs", (view) => {
      const rows = shared[view] as Row[];

      expect([
        rows.some(ownedBy(organizations, ORG_A)),
        rows.some(ownedBy(organizations, ORG_B)),
      ]).toEqual([true, true]);
    });
  });
});
