/**
 * @vitest-environment node
 * @see specs/upgrade/rerunnable-migrations.feature
 */
import { describe, expect, it } from "vitest";

import {
  findHandAppliedSql,
  isRerunnablePrismaMigration,
  RERUNNABLE_EXEMPT_PRISMA,
  RERUNNABLE_PRISMA_FROM,
} from "../rerunnable-migrations.ts";

const SINGLE_STATEMENT = [
  "20261002090000_join_request_origin",
  "20261006120001_grant_condition",
  "20261006120002_project_aggregate_rule",
];
const TWO_STATEMENT = [
  "20261001120001_organization_instant_evals_opt_in",
  "20261001120002_developer_seat",
];

describe("rerunnable migrations", () => {
  /** @scenario "Main's single-statement folders after the marker count as re-runnable" */
  it("re-runs main's single-statement folders and never its two-statement ones", () => {
    expect([...RERUNNABLE_EXEMPT_PRISMA].toSorted()).toEqual(
      [...SINGLE_STATEMENT, ...TWO_STATEMENT].toSorted(),
    );
    expect(SINGLE_STATEMENT.map((name) => isRerunnablePrismaMigration({ name }))).toEqual([
      true,
      true,
      true,
    ]);
    expect(TWO_STATEMENT.map((name) => isRerunnablePrismaMigration({ name }))).toEqual([
      false,
      false,
    ]);
    expect(isRerunnablePrismaMigration({ name: RERUNNABLE_PRISMA_FROM })).toBe(false);
  });

  it("gives guarded SQL and the applied record for a two-statement folder only", () => {
    const [name] = TWO_STATEMENT;
    const sql = findHandAppliedSql({ name: name! });
    expect(sql.slice(0, 2).every((each) => each.includes("IF NOT EXISTS"))).toBe(true);
    expect(sql.at(-1)).toContain(`"migration_name" = '${name}'`);
    expect(findHandAppliedSql({ name: SINGLE_STATEMENT[0]! })).toEqual([]);
  });
});
