// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * The two department questions the People screen has to keep apart.
 *
 * A discovered person can carry a department from either of two places, and
 * they are not the same claim:
 *
 *  - `directoryDepartment` — free text the provider's directory asserted. It
 *    exists for people who hold no LangWatch account, which on a fresh tenant
 *    is nearly everyone, and nothing rolls spend up by it.
 *  - `link.departmentName` — the `Department` the organization assigned to the
 *    member this person is linked to. An administrator created that row, spend
 *    attributes to it, and it can be renamed and archived.
 *
 * `departmentLabelFor` picks one to SHOW; `groupObservedDepartments` counts
 * only the first, because a panel headed "departments the providers see" that
 * counted our own assignments would be reporting our answers back to us.
 *
 * Framework-free on purpose: the People page imports it directly, so it must
 * not drag anything server-side or browser-side across that boundary.
 *
 * Spec: specs/governance/governance-people-screen.feature
 */

/** Only what these functions read, so each is callable from a test with a literal. */
export interface PersonDepartmentFacts {
  directoryDepartment: string | null;
  erasedAt: Date | null;
  link: { departmentName: string | null } | null;
}

/**
 * The directory's department for a person the screen is allowed to describe.
 *
 * Erasure already nulls the stored column, so this is belt and braces — kept
 * because "an erased person is described by nothing but their stand-in" is a
 * property of every surface that reads them, not a detail of one write path.
 */
function directoryDepartmentOf(person: PersonDepartmentFacts): string | null {
  if (person.erasedAt !== null) return null;
  return person.directoryDepartment === "" ? null : person.directoryDepartment;
}

/**
 * The one department to show on a person's row, or null.
 *
 * The directory wins when it named one. It is a fact about THIS provider-side
 * identity, where the linked member's department is a fact about an account we
 * decided is the same human — one hop further from the row being read, and the
 * hop the reader cannot see. The linked value stays the fallback so a person
 * an administrator assigned by hand still reads as assigned.
 */
export function departmentLabelFor(
  person: PersonDepartmentFacts,
): string | null {
  if (person.erasedAt !== null) return null;
  return directoryDepartmentOf(person) ?? person.link?.departmentName ?? null;
}

/** A department name the providers used, and how many people they used it for. */
export interface ObservedDepartment {
  name: string;
  peopleCount: number;
}

/**
 * The distinct departments the providers filed discovered people under,
 * busiest first.
 *
 * This is not the `Department` list and must never be rendered as one: these
 * names carry no id, cannot be renamed or archived, and no spend rolls up by
 * them. What they are good for is telling an administrator which departments
 * their directory actually contains before they create a single one.
 *
 * Ties break on name so the order is stable across reads — a panel that
 * reshuffles equal-count rows between refreshes reads as though the data
 * changed.
 */
export function groupObservedDepartments(
  people: PersonDepartmentFacts[],
): ObservedDepartment[] {
  const countByName = new Map<string, number>();
  for (const person of people) {
    const name = directoryDepartmentOf(person);
    if (name === null) continue;
    countByName.set(name, (countByName.get(name) ?? 0) + 1);
  }
  return [...countByName]
    .map(([name, peopleCount]) => ({ name, peopleCount }))
    .sort(
      (a, b) => b.peopleCount - a.peopleCount || a.name.localeCompare(b.name),
    );
}
