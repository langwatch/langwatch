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
 * The fold key for deciding two names are the same department.
 *
 * Case- and whitespace-insensitive, because the collision this exists for is a
 * human one: an administrator creates "Engineering" and their directory sends
 * "engineering". Two rows reading the same word with no visible difference
 * between them is exactly the confusion the second table used to cause.
 */
const foldName = (name: string) => name.trim().toLowerCase();

/**
 * Every department the tab shows, once each.
 *
 * A created department and a directory name that fold to the same key are ONE
 * row: the reader is looking at one department, and the truthful thing to say
 * about it is that they created it AND a directory also files people under it.
 * Splitting them would print the same word twice and leave the reader to guess
 * which one their spend attributes to.
 *
 * The organization's own name wins the display when both exist, because that is
 * the name spend attributes under and the one that appears in the assignment
 * pickers; the directory's casing is an observation about somebody else's
 * system.
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
    if (existing) {
      rows.set(key, {
        ...existing,
        providers: seen.providers,
        directoryPeopleCount: seen.peopleCount,
      });
      continue;
    }
    rows.set(key, {
      // A discovered name has no identifier of its own, so the folded name is
      // the only stable key available for it. Prefixed so it can never collide
      // with a record's id.
      key: `observed:${key}`,
      name: seen.name,
      record: null,
      providers: seen.providers,
      directoryPeopleCount: seen.peopleCount,
    });
  }

  return [...rows.values()].sort((a, b) => a.name.localeCompare(b.name));
}
