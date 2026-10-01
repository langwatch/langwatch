// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import type { NormalizedPullEvent } from "@langwatch/enterprise-governance-contract";
import { createLogger } from "@langwatch/observability";
import type { OrganizationApi } from "@langwatch/organization-contract";

import type { DiscoveredPersonRepository } from "../repositories/discovered-person.repository.ts";
import type { IdentityMatchRepository } from "../repositories/identity-match.repository.ts";
import { deriveProvenUserId, extraString } from "../rules/directory-department.rules.ts";
import { DIRECTORY_REPORT_ACTION } from "../rules/microsoft-graph-directory.rules.ts";
import type { DepartmentService } from "./department.service.ts";
import type { IdentityMatchService } from "./identity-match.service.ts";

const logger = createLogger("langwatch:governance:directory-departments");

export interface DirectoryDepartmentSyncDependencies {
  departments: Pick<
    DepartmentService,
    "resolveByNameOrCreate" | "assignUser" | "findOpenUserLinks"
  >;
  matcher: Pick<IdentityMatchService, "loadAccountIndex">;
  discoveredPeople: Pick<DiscoveredPersonRepository, "findByActorIds">;
  matches: Pick<IdentityMatchRepository, "findOpenByOrganization">;
  organizations: Pick<OrganizationApi, "findMemberDepartments">;
}

/**
 * The directory's department field, landed on members it proves; a blank one changes nothing.
 * Port of main `directoryDepartmentSync.service.ts`; fed KEPT events only.
 * Spec: specs/governance/governance-people-discovery.feature
 */
export class DirectoryDepartmentSyncService {
  private constructor(private readonly deps: DirectoryDepartmentSyncDependencies) {}

  static create(deps: DirectoryDepartmentSyncDependencies): DirectoryDepartmentSyncService {
    return new DirectoryDepartmentSyncService(deps);
  }

  async applyDirectoryEvents({
    organizationId,
    provider,
    events,
  }: {
    organizationId: string;
    provider: string;
    events: NormalizedPullEvent[];
  }): Promise<{ assigned: number }> {
    const rows = events.filter(
      (event) =>
        event.action === DIRECTORY_REPORT_ACTION && extraString(event, "department").trim() !== "",
    );
    if (rows.length === 0) return { assigned: 0 };

    const [accounts, openLinkByActor] = await Promise.all([
      this.deps.matcher.loadAccountIndex({ organizationId }),
      this.loadOpenLinkByActor({
        organizationId,
        provider,
        rawActorIds: [...new Set(rows.map((row) => row.actor))],
      }),
    ]);

    const desired = new Map<string, string>();
    for (const row of rows) {
      const department = extraString(row, "department").trim();
      const userId = deriveProvenUserId({
        row,
        accounts,
        openLinkUserId: openLinkByActor.get(row.actor) ?? null,
      });
      if (userId !== undefined) desired.set(userId, department);
    }
    if (desired.size === 0) return { assigned: 0 };

    const assigned = await this.assignWhereChanged({ organizationId, desired });
    if (assigned > 0) {
      logger.info({ organizationId, assigned }, "directory departments assigned to proven members");
    }
    return { assigned };
  }

  private async loadOpenLinkByActor({
    organizationId,
    provider,
    rawActorIds,
  }: {
    organizationId: string;
    provider: string;
    rawActorIds: string[];
  }): Promise<Map<string, string>> {
    const people = await this.deps.discoveredPeople.findByActorIds({
      organizationId,
      provider,
      rawActorIds,
    });
    if (people.length === 0) return new Map();

    const openLinks = await this.deps.matches.findOpenByOrganization({ organizationId });
    const userByPersonId = new Map(openLinks.map((link) => [link.discoveredPersonId, link.userId]));

    const byActor = new Map<string, string>();
    for (const person of people) {
      const userId = userByPersonId.get(person.id);
      if (typeof userId === "string") byActor.set(person.rawActorId, userId);
    }
    return byActor;
  }

  private async assignWhereChanged({
    organizationId,
    desired,
  }: {
    organizationId: string;
    desired: Map<string, string>;
  }): Promise<number> {
    const userIds = [...desired.keys()];
    const [memberships, openLinks] = await Promise.all([
      this.deps.organizations.findMemberDepartments({ organizationId, userIds }),
      this.deps.departments.findOpenUserLinks({ organizationId, userIds }),
    ]);
    const currentByUser = new Map(memberships.map((m) => [m.userId, m.departmentId]));
    const openLinkByUser = new Map(openLinks.map((link) => [link.userId, link.departmentId]));

    const departmentByName = new Map<string, string>();
    let assigned = 0;
    for (const [userId, name] of desired) {
      if (!currentByUser.has(userId)) continue;

      let departmentId = departmentByName.get(name);
      if (departmentId === undefined) {
        departmentId = (await this.deps.departments.resolveByNameOrCreate({ organizationId, name }))
          .id;
        departmentByName.set(name, departmentId);
      }

      if (
        currentByUser.get(userId) === departmentId &&
        openLinkByUser.get(userId) === departmentId
      ) {
        continue;
      }
      await this.deps.departments.assignUser({ organizationId, userId, departmentId });
      assigned += 1;
    }
    return assigned;
  }
}
