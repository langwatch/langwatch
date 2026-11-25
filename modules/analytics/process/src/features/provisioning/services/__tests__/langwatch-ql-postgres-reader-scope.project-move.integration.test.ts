/**
 * Row scope follows the project's current organization, and a group member holding no
 * organization role sees nothing.
 * @see ../langwatch-ql-postgres-views.service.ts
 * @vitest-environment node
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  canon,
  ORG_B,
  PROJECT_A,
  PROJECT_B,
  q,
  READER_A,
  READER_B,
  READER_NONE,
  type Row,
  type RowsByView,
  type ScopeHarness,
  SCHEMA,
  SCOPED,
  SHARED_READER,
  startScopeHarness,
  tenantsOf,
  VIEW_NAMES,
  VIEWS,
} from "./langwatch-ql-postgres-reader-scope.fixtures.ts";

describe("given per-reader row scoping over every generated Postgres view", () => {
  let harness: ScopeHarness;
  const admin = (sql: string) => harness.admin(sql);

  beforeAll(async () => {
    harness = await startScopeHarness();
  }, 600_000);

  afterAll(async () => {
    await harness?.stop();
  });

  describe("when a group member holds no organization role", () => {
    let ungrouped: RowsByView;

    beforeAll(async () => {
      ungrouped = await harness.readAllViews({ user: READER_NONE, schema: SCOPED });
    });

    /** @scenario "A Postgres reader login with no organization role sees no rows" */
    it.each(VIEW_NAMES)("%s: a group member with no org role sees no rows", (view) => {
      expect(ungrouped[view]).toEqual([]);
    });
  });

  describe("when a project moves to another organization's team", () => {
    let shared: RowsByView;
    let readerB: RowsByView;
    let movedA: RowsByView;
    let movedB: RowsByView;
    let movedOrganizations: Record<string, string>;

    beforeAll(async () => {
      [shared, readerB] = await Promise.all([
        harness.readAllViews({ user: SHARED_READER, schema: SCHEMA }),
        harness.readAllViews({ user: READER_B, schema: SCOPED }),
      ]);
      const teamB = await admin(
        `SELECT "teamId" FROM ${q(SCHEMA)}."Project" WHERE id = '${PROJECT_B}'`,
      );
      const teamA = await admin(
        `SELECT "teamId" FROM ${q(SCHEMA)}."Project" WHERE id = '${PROJECT_A}'`,
      );
      await admin(
        `UPDATE ${q(SCHEMA)}."Project" SET "teamId" = '${teamB}' WHERE id = '${PROJECT_A}'`,
      );
      try {
        [movedA, movedB, movedOrganizations] = await Promise.all([
          harness.readAllViews({ user: READER_A, schema: SCOPED }),
          harness.readAllViews({ user: READER_B, schema: SCOPED }),
          harness.projectOrganizations(),
        ]);
      } finally {
        await admin(
          `UPDATE ${q(SCHEMA)}."Project" SET "teamId" = '${teamA}' WHERE id = '${PROJECT_A}'`,
        );
      }
    });

    it("the project now belongs to org_b", () => {
      expect(movedOrganizations[PROJECT_A]).toBe(ORG_B);
    });

    /** @scenario "A Postgres reader's row scope follows a project moved to another organization" */
    it.each(VIEW_NAMES)("%s: the org_a login no longer sees the moved project", (view) => {
      expect(tenantsOf(movedA[view] as Row[])).not.toContain(PROJECT_A);
    });

    /** @scenario "A Postgres reader's row scope follows a project moved to another organization" */
    it.each(VIEW_NAMES)("%s: the org_b login sees every row it saw before", (view) => {
      const after = new Set(canon(movedB[view] as Row[]));
      const missing = canon(readerB[view] as Row[]).filter((row) => !after.has(row));

      expect(missing).toEqual([]);
    });

    /** @scenario "A Postgres reader's row scope follows a project moved to another organization" */
    it("an annotation-style project-path view moves the project's rows to the org_b login", () => {
      const projectPathView = VIEWS.find(
        (view) =>
          (view.postgres.tenantPath ?? []).length === 0 &&
          (shared[view.postgres.approvedView] as Row[]).some((r) => r.TenantId === PROJECT_A),
      );
      const rows = movedB[projectPathView?.postgres.approvedView ?? ""] as Row[] | undefined;

      expect(rows?.some((row) => row.TenantId === PROJECT_A)).toBe(true);
    });
  });
});
