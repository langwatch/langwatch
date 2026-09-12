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
 * only the first, because the discovered half of the Departments tab is a
 * report of what the connected directories say, and counting our own
 * assignments into it would be reporting our answers back to us.
 *
 * Framework-free on purpose: the People page imports it directly, so it must
 * not drag anything server-side or browser-side across that boundary.
 *
 * Spec: specs/governance/governance-people-screen.feature
 */

/** Only what these functions read, so each is callable from a test with a literal. */
export interface PersonDepartmentFacts {
  /**
   * The connected source that named this person — `DiscoveredPerson.provider`,
   * a slug such as `openai_admin`. It is what puts a provider's name on a
   * discovered department: the department is free text, so the only thing that
   * says where the text came from is the people filed under it.
   */
  provider: string;
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

/** A department name the providers used, and who used it for how many people. */
export interface ObservedDepartment {
  name: string;
  peopleCount: number;
  /**
   * Every provider whose directory filed somebody under this name, sorted so
   * two reads render the same badges in the same order. Never empty: a name
   * only appears here because a provider's directory used it.
   */
  providers: string[];
}

/**
 * The distinct departments the providers filed discovered people under,
 * busiest first, each carrying the providers that named it.
 *
 * This is not the `Department` list and must never be presented as one: these
 * names carry no id, cannot be renamed or archived, and no spend rolls up by
 * them. The Departments tab shows both on one table and tells them apart by a
 * badge naming the provider, which is why the providers are gathered here
 * rather than left for the page to re-derive.
 *
 * Ties break on name so the order is stable across reads — a list that
 * reshuffles equal-count rows between refreshes reads as though the data
 * changed.
 */
export function groupObservedDepartments(
  people: PersonDepartmentFacts[],
): ObservedDepartment[] {
  const byName = new Map<
    string,
    { peopleCount: number; providers: Set<string> }
  >();
  for (const person of people) {
    const name = directoryDepartmentOf(person);
    if (name === null) continue;
    const entry = byName.get(name) ?? { peopleCount: 0, providers: new Set() };
    entry.peopleCount += 1;
    entry.providers.add(person.provider);
    byName.set(name, entry);
  }
  return [...byName]
    .map(([name, { peopleCount, providers }]) => ({
      name,
      peopleCount,
      providers: [...providers].sort(),
    }))
    .sort(
      (a, b) => b.peopleCount - a.peopleCount || a.name.localeCompare(b.name),
    );
}
