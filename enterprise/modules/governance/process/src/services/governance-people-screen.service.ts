// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import type {
  PeopleScreenPerson,
  PeopleScreenSuggestion,
} from "@langwatch/enterprise-governance-contract";
import type { OrganizationApi } from "@langwatch/organization-contract";
import { toDate } from "@langwatch/time";

import type { DiscoveredPersonRepository } from "../repositories/discovered-person.repository.ts";
import type { IdentityMatchSuggestionRepository } from "../repositories/identity-match-suggestion.repository.ts";
import type { IdentityMatchRepository } from "../repositories/identity-match.repository.ts";
import type { DepartmentService } from "./department.service.ts";

type Members = Pick<OrganizationApi, "findMembersWithDepartments">;

/** Main's `governancePeopleScreen.service.ts`: the People screen's two reads. */
export class GovernancePeopleScreenService {
  private constructor(
    private readonly deps: {
      discoveredPeople: DiscoveredPersonRepository;
      matches: IdentityMatchRepository;
      suggestions: IdentityMatchSuggestionRepository;
      departments: Pick<DepartmentService, "getAll">;
      organizations: Members;
    },
  ) {}

  static create(deps: {
    discoveredPeople: DiscoveredPersonRepository;
    matches: IdentityMatchRepository;
    suggestions: IdentityMatchSuggestionRepository;
    departments: Pick<DepartmentService, "getAll">;
    organizations: Members;
  }): GovernancePeopleScreenService {
    return new GovernancePeopleScreenService(deps);
  }

  async listPeople({ organizationId }: { organizationId: string }): Promise<PeopleScreenPerson[]> {
    const [people, openLinks, members, departments] = await Promise.all([
      this.deps.discoveredPeople.findByOrganization({ organizationId }),
      this.deps.matches.findOpenByOrganization({ organizationId }),
      this.deps.organizations.findMembersWithDepartments({ organizationId }),
      this.deps.departments.getAll({ organizationId }),
    ]);
    const linkByPerson = new Map(openLinks.map((link) => [link.discoveredPersonId, link]));
    const nameByUser = memberNames(members);
    const departmentNameById = new Map(departments.map((d) => [d.id, d.name]));
    const departmentIdByUser = new Map(members.map((m) => [m.userId, m.departmentId]));

    return people.map((person) => {
      const open = linkByPerson.get(person.id);
      const departmentId = open?.userId ? departmentIdByUser.get(open.userId) : undefined;
      return {
        id: person.id,
        provider: person.provider,
        kind: person.kind,
        displayText: person.displayText,
        rawActorId: person.rawActorId,
        directoryDepartment: person.department,
        firstSeenAt: toDate(person.firstSeenAt),
        lastSeenAt: toDate(person.lastSeenAt),
        erasedAt: person.erasedAt ? toDate(person.erasedAt) : null,
        suspendedAt: person.suspendedAt ? toDate(person.suspendedAt) : null,
        suspendedReason: person.suspendedReason,
        link:
          open?.userId == null
            ? null
            : {
                userId: open.userId,
                evidenceKind: open.evidenceKind,
                memberName: nameByUser.get(open.userId) ?? null,
                departmentName: departmentId
                  ? (departmentNameById.get(departmentId) ?? null)
                  : null,
              },
      };
    });
  }

  async listSuggestions({
    organizationId,
  }: {
    organizationId: string;
  }): Promise<PeopleScreenSuggestion[]> {
    const [rows, people, members] = await Promise.all([
      this.deps.suggestions.findAllByOrganization({ organizationId }),
      this.deps.discoveredPeople.findByOrganization({ organizationId }),
      this.deps.organizations.findMembersWithDepartments({ organizationId }),
    ]);
    const personById = new Map(people.map((person) => [person.id, person]));
    const nameByUser = memberNames(members);

    return rows.flatMap((row) => {
      const person = personById.get(row.discoveredPersonId);
      if (!person) return [];
      return [
        {
          id: row.id,
          discoveredPersonId: row.discoveredPersonId,
          personDisplayText: person.displayText,
          personProvider: person.provider,
          userId: row.userId,
          memberName: nameByUser.get(row.userId) ?? null,
          score: row.score,
        },
      ];
    });
  }
}

/** Main's `findMemberNames`: the display name, else the address, else nothing. */
function memberNames(
  members: Awaited<ReturnType<Members["findMembersWithDepartments"]>>,
): Map<string, string> {
  const names = new Map<string, string>();
  for (const member of members) {
    const name = member.user.name ?? member.user.email;
    if (name) names.set(member.userId, name);
  }
  return names;
}
