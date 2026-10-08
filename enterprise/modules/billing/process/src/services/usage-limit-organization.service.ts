import type { BillingUsageLimitOrganization } from "@langwatch/enterprise-billing-contract";
import { OrganizationNotFoundError, type OrganizationApi } from "@langwatch/organization-contract";
import type { Instant } from "@langwatch/time";

import type { BillingProjectDirectoryRepository } from "../repositories/billing-project-directory.repository.ts";
import type { BillingLifecycleAnnouncerService } from "./billing-lifecycle-announcer.service.ts";

type UsageLimitOrganizationPeers = Readonly<{
  organizations: Pick<OrganizationApi, "getWithAdministrators">;
  projects: Pick<BillingProjectDirectoryRepository, "findProjectsWithName">;
  /** The stamp is billing's fact, which organization applies to its row (R42). */
  stamps: Pick<BillingLifecycleAnnouncerService, "planLimitAlertSent">;
}>;

/** Main's `OrganizationService` reads for the usage-limit mail; projects through their share. */
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
    return this.peers.stamps.planLimitAlertSent({ organizationId, sentAt: timestamp });
  }

  /** Main's `findProjectsWithName`: every non-governance project, by name. */
  findProjectsWithName(organizationId: string): Promise<{ id: string; name: string }[]> {
    return this.peers.projects.findProjectsWithName({ organizationId });
  }
}
