/**
 * ONE departments table, built from the two things that can put a department
 * name on this screen.
 *
 * The tab used to carry two lists stacked on each other: the organization's own
 * `Department` records, and a separate panel of the names the connected
 * directories use. They hold the same kind of thing — a department — and a
 * reader was asked to work out for themselves why "Engineering" appeared twice.
 * They are one table now, and the only thing that distinguishes a row a
 * directory named is a badge saying which provider named it.
 *
 * WHAT THE BADGE COSTS US. A created department is a record: it has an
 * identifier, spend rolls up by it, and it can be renamed and archived. A
 * discovered one is free text a provider's directory asserted about people who
 * mostly hold no LangWatch account, and nothing rolls up by it. That difference
 * is real and it still governs the row actions — a row with no record behind it
 * is offered neither Rename nor Archive, because there is nothing to rename.
 * What has changed is that the difference no longer earns a heading, a
 * paragraph and a second table; it earns a badge.
 *
 * Spec: specs/ai-governance/dashboard/people-tabs.feature
 * Spec: specs/governance/governance-people-screen.feature
 */

import type { ObservedDepartment } from "@ee/governance/services/logic/observedDepartments";

/** The organization's own department record, reduced to what a row draws. */
export interface DepartmentRecord {
  id: string;
  name: string;
}

export interface DepartmentTableRow {
  key: string;
  /** The name as the row shows it. */
  name: string;
  /**
   * The organization's own record under this name, or `null` for a name only a
   * directory has used. This is what decides whether the row can be renamed and
   * archived, so the row never has to re-derive it from the badges.
   */
  record: DepartmentRecord | null;
  /**
   * The providers whose directories filed people under this name. Empty for a
   * department nobody's directory has named, which is what leaves the row
   * without a badge.
   */
  providers: readonly string[];
  /**
   * How many people the directories filed under this name, or `null` when no
   * directory named it at all.
   *
   * Null rather than zero, and the distinction is not pedantry: this figure
   * counts the directory's people, not the members an administrator assigned.
   * A created department with nobody discovered under it has a headcount we did
   * not measure, and printing `0` beside it would tell an administrator their
   * department is empty when it may hold half the company.
   */
  directoryPeopleCount: number | null;
}

/**
 * The key deciding that a directory's department and one of ours are the same
 * department: the trimmed name, compared exactly.
 *
 * This is not a rule this screen gets to invent. The backend already maps
 * directory department text onto `Department` rows, on both paths that carry it
 * — the SCIM push (`scim.service.ts`) and the daily directory pull
 * (`directoryDepartmentSync.service.ts`) — and both do it by trimming the
 * directory's text and handing it to `DepartmentService.resolveByNameOrCreate`,
 * which looks the name up with an exact, case-SENSITIVE equality behind a
 * partial unique index on `(organizationId, name)` where the row is active.
 *
 * So a directory sending "engineering" to an organization that created
 * "Engineering" does not join it — it causes a second `Department` row to be
 * created, and the two attribute spend separately. Folding case here would
 * print that pair as one row and tell the reader their spend lands in one place
 * when it lands in two; worse, it would drop one of the two records off the
 * table, leaving a real department that can never be renamed or archived from
 * this screen. The table matches the predicate the writes use.
 */
const foldName = (name: string) => name.trim();

/**
 * Every department the tab shows, once each.
 *
 * A created department and a directory name with the same trimmed name are ONE
 * row: they are one department — the backend resolves the directory's text to
 * exactly that record — and the truthful thing to say is that the organization
 * created it AND a directory also files people under it. Splitting them would
 * print the same word twice and leave the reader to guess which one their spend
 * attributes to.
 *
 * Two records can never collide here: the partial unique index makes at most one
 * active `Department` per name, so no record's row can be overwritten by
 * another's.
 *
 * Ordered by name. One list the reader looks a department up in, so it is
 * ordered the way a reader looks things up — not by headcount, which would rank
 * the discovered rows above the created ones and rebuild the two groups the
 * single table exists to remove.
 */
export function mergeDepartmentRows({
  departments,
  observed,
}: {
  departments: readonly DepartmentRecord[];
  observed: readonly ObservedDepartment[];
}): DepartmentTableRow[] {
  const rows = new Map<string, DepartmentTableRow>();

  for (const department of departments) {
    rows.set(foldName(department.name), {
      key: department.id,
      name: department.name,
      record: department,
      providers: [],
      directoryPeopleCount: null,
    });
  }

  for (const seen of observed) {
    const key = foldName(seen.name);
    const existing = rows.get(key);
    // `groupObservedDepartments` groups on the directory's verbatim text, so
    // "Engineering" and " Engineering " reach here as two entries. The backend
    // trims before resolving and would land both on one `Department`, so they
    // are one row — and the row has to ADD them up rather than let whichever
    // arrived last stand for both, which would drop a provider's badge and
    // undercount the people it named.
    rows.set(key, {
      // A discovered name has no identifier of its own, so the folded name is
      // the only key available for it. Prefixed so it can never collide with a
      // record's id.
      key: existing?.key ?? `observed:${key}`,
      name: existing?.name ?? seen.name,
      record: existing?.record ?? null,
      providers: [
        ...new Set([...(existing?.providers ?? []), ...seen.providers]),
      ].sort(),
      directoryPeopleCount:
        (existing?.directoryPeopleCount ?? 0) + seen.peopleCount,
    });
  }

  return [...rows.values()].sort((a, b) => a.name.localeCompare(b.name));
}
