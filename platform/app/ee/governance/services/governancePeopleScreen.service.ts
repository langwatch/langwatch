// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * The People screen's reads, composed once on the server.
 *
 * The screen shows three things no single table holds: what a provider said
 * (the discovered person), what the engine decided (the open link and its
 * evidence), and where the linked member sits (name and department). Joining
 * them here rather than in the page keeps the page on one query and keeps
 * the join rules — an erased person shows a stand-in, a link with a blanked
 * user shows as unlinked — in code a test can hold down.
 *
 * Spec: specs/governance/governance-people-screen.feature
 */

import type { PrismaClient } from "~/generated/prisma/client";

import {
  DiscoveredPersonRepository,
  IdentityMatchRepository,
  IdentityMatchSuggestionRepository,
  OrganizationAccountDirectoryRepository,
} from "../repositories/governanceIdentity.repository";
import { DepartmentService } from "./department/department.service";

export interface PeopleScreenPerson {
  id: string;
  provider: string;
  kind: string;
  /** The pseudonym when erased — the identifier column IS this text then. */
  displayText: string;
  rawActorId: string;
  firstSeenAt: Date;
  lastSeenAt: Date;
  erasedAt: Date | null;
  suspendedAt: Date | null;
  suspendedReason: string | null;
  link: {
    userId: string;
    evidenceKind: string;
    memberName: string | null;
    departmentName: string | null;
  } | null;
}

export interface PeopleScreenSuggestion {
  id: string;
  discoveredPersonId: string;
  personDisplayText: string;
  personProvider: string;
  userId: string;
  memberName: string | null;
  score: number;
}

export class GovernancePeopleScreenService {
  private readonly prisma: PrismaClient;
  private readonly people = new DiscoveredPersonRepository();
  private readonly matches = new IdentityMatchRepository();
  private readonly suggestions = new IdentityMatchSuggestionRepository();
  private readonly accounts = new OrganizationAccountDirectoryRepository();
  private readonly departments: DepartmentService;

  constructor({ prisma }: { prisma: PrismaClient }) {
    this.prisma = prisma;
    this.departments = DepartmentService.create(prisma);
  }

  static create(prisma: PrismaClient): GovernancePeopleScreenService {
    return new GovernancePeopleScreenService({ prisma });
  }

  /** Everyone the providers named, newest-seen first, with the engine's verdicts. */
  async listPeople({
    organizationId,
  }: {
    organizationId: string;
  }): Promise<PeopleScreenPerson[]> {
    const [people, openLinks, memberNames, departmentRows, assignments] =
      await Promise.all([
        this.people.listByOrganization(this.prisma, { organizationId }),
        this.matches.findOpenByOrganization(this.prisma, { organizationId }),
        this.accounts.findMemberNames(this.prisma, { organizationId }),
        this.departments.getAll({ organizationId }),
        this.departments.getAssignments({ organizationId }),
      ]);

    const linkByPerson = new Map(
      openLinks.map((link) => [link.discoveredPersonId, link]),
    );
    const nameByUser = new Map(memberNames.map((m) => [m.userId, m.name]));
    const departmentNameById = new Map(
      departmentRows.map((d) => [d.id, d.name]),
    );
    const departmentIdByUser = new Map(
      assignments.users.map((u) => [u.id, u.departmentId]),
    );

    return people.map((person) => {
      const open = linkByPerson.get(person.id);
      // `findOpenByOrganization` already excludes blanked links, so a link
      // here always names a user; the null check keeps the type honest.
      const link =
        open?.userId == null
          ? null
          : {
              userId: open.userId,
              evidenceKind: open.evidenceKind,
              memberName: nameByUser.get(open.userId) ?? null,
              departmentName: (() => {
                const departmentId = departmentIdByUser.get(open.userId);
                return departmentId
                  ? (departmentNameById.get(departmentId) ?? null)
                  : null;
              })(),
            };
      return {
        id: person.id,
        provider: person.provider,
        kind: person.kind,
        displayText: person.displayText,
        rawActorId: person.rawActorId,
        firstSeenAt: person.firstSeenAt,
        lastSeenAt: person.lastSeenAt,
        erasedAt: person.erasedAt,
        suspendedAt: person.suspendedAt,
        suspendedReason: person.suspendedReason,
        link,
      };
    });
  }

  /** The review queue with both halves named, strongest candidate first. */
  async listSuggestions({
    organizationId,
  }: {
    organizationId: string;
  }): Promise<PeopleScreenSuggestion[]> {
    const [rows, people, memberNames] = await Promise.all([
      this.suggestions.findAllByOrganization(this.prisma, { organizationId }),
      this.people.listByOrganization(this.prisma, { organizationId }),
      this.accounts.findMemberNames(this.prisma, { organizationId }),
    ]);

    const personById = new Map(people.map((p) => [p.id, p]));
    const nameByUser = new Map(memberNames.map((m) => [m.userId, m.name]));

    return rows.flatMap((row) => {
      const person = personById.get(row.discoveredPersonId);
      // A suggestion whose person is gone is a row the next recompute drops;
      // showing a half it cannot name helps nobody meanwhile.
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
