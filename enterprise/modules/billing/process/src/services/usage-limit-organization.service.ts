import type { BillingUsageLimitOrganization } from "@langwatch/enterprise-billing-contract";
import { OrganizationNotFoundError, type OrganizationApi } from "@langwatch/organization-contract";
import type { ProjectApi } from "@langwatch/project-contract";
import type { Instant } from "@langwatch/time";

type UsageLimitOrganizationPeers = Readonly<{
  organizations: Pick<OrganizationApi, "getWithAdministrators" | "updateSentPlanLimitAlert">;
  projects: Pick<ProjectApi, "findProjectsWithDepartments">;
}>;

/** Main's `OrganizationService` reads for the usage-limit mail, over the owners' operations. */
export class UsageLimitOrganizationService implements BillingUsageLimitOrganization {
  static create(peers: UsageLimitOrganizationPeers): UsageLimitOrganizationService {
    return new UsageLimitOrganizationService(peers);
  }

  private constructor(private readonly peers: UsageLimitOrganizationPeers) {}

  async findWithAdmins(
    organizationId: string,
  ): ReturnType<BillingUsageLimitOrganization["findWithAdmins"]> {
    try {
      const organization = await this.peers.organizations.getWithAdministrators({
        organizationId,
      });
      return {
        id: organization.id,
        name: organization.name,
        sentPlanLimitAlert: organization.sentPlanLimitAlert,
        members: organization.administrators.map((admin) => ({
          user: { id: admin.userId, name: admin.name, email: admin.email },
        })),
      };
    } catch (error) {
      if (error instanceof OrganizationNotFoundError) return null;
      throw error;
    }
  }

  updateSentPlanLimitAlert(organizationId: string, timestamp: Instant): Promise<void> {
    return this.peers.organizations.updateSentPlanLimitAlert({ organizationId, sentAt: timestamp });
  }

  /** Main's `findProjectsWithName`: every non-governance project, by name. */
  async findProjectsWithName(organizationId: string): Promise<{ id: string; name: string }[]> {
    const projects = await this.peers.projects.findProjectsWithDepartments({ organizationId });
    return projects.map(({ id, name }) => ({ id, name }));
  }
}
