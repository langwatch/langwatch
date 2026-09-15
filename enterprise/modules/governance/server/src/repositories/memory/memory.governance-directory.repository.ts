// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import {
  GovernanceDirectory,
  type GovernanceDirectoryProject,
  type GovernanceMembershipStatus,
} from "../directory/governance-directory.repository.ts";
import type { MemoryGovernanceStore } from "./memory-governance.store.ts";

/** The directory twin: identity, membership and project rows from one store. */
export class MemoryGovernanceDirectoryRepository extends GovernanceDirectory {
  private constructor(private readonly store: MemoryGovernanceStore) {
    super();
  }

  static create(store: MemoryGovernanceStore): MemoryGovernanceDirectoryRepository {
    return new MemoryGovernanceDirectoryRepository(store);
  }

  async membershipStatus(params: {
    userId: string;
    organizationId: string;
  }): Promise<GovernanceMembershipStatus> {
    if (!this.store.people.has(params.userId)) return "user_missing";

    const seat = this.store.members.find(
      (member) =>
        member.userId === params.userId && member.organizationId === params.organizationId,
    );
    if (!seat) return "not_org_member";

    return seat.deactivated ? "user_deactivated" : "active";
  }

  async findPersonProfile(
    userId: string,
  ): Promise<{ name: string | null; email: string | null } | null> {
    const person = this.store.people.get(userId);
    return person ? { name: person.name, email: person.email } : null;
  }

  async findOrganizationIdByProjectApiKey(apiKey: string): Promise<string | null> {
    return this.store.projects.find((project) => project.apiKey === apiKey)?.organizationId ?? null;
  }

  async findMemberIdByEmail(params: {
    email: string;
    organizationId: string;
  }): Promise<string | null> {
    for (const member of this.store.members) {
      if (member.organizationId !== params.organizationId) continue;
      if (this.store.people.get(member.userId)?.email === params.email) return member.userId;
    }
    return null;
  }

  async findLiveProjectBySlug(params: {
    slug: string;
    organizationId: string;
  }): Promise<(GovernanceDirectoryProject & { apiKey: string }) | null> {
    const project = this.store.projects.find(
      (row) =>
        !row.archived && row.slug === params.slug && row.organizationId === params.organizationId,
    );
    if (!project) return null;

    return { ...this.view(project), apiKey: project.apiKey };
  }

  async findLiveProjectByRef(params: {
    projectRef: string;
    organizationId: string;
  }): Promise<GovernanceDirectoryProject | null> {
    const project = this.store.projects.find(
      (row) =>
        !row.archived &&
        row.organizationId === params.organizationId &&
        (row.id === params.projectRef || row.slug === params.projectRef),
    );
    return project ? this.view(project) : null;
  }

  private view(project: GovernanceDirectoryProject): GovernanceDirectoryProject {
    return {
      id: project.id,
      slug: project.slug,
      name: project.name,
      isPersonal: project.isPersonal,
      ownerUserId: project.ownerUserId,
    };
  }
}
