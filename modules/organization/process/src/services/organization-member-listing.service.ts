/**
 * The member listing step's page: a page of organizations' active members, each recorded as one
 * `member_listed` fact in one batch, so a peer fills its member copy from organization's log.
 * Spec: modules/organization/specs/organization-service.feature
 */
import type { EventingCommandSender } from "@langwatch/eventing";
import { nowInstant } from "@langwatch/time";

import type { RecordMemberListedCommandData } from "../eventing/organization-lifecycle.events.ts";
import type { OrganizationRepository } from "../repositories/organization.repository.ts";

export type OrganizationMemberListingSenders = Readonly<{
  recordMemberListed: Pick<EventingCommandSender<RecordMemberListedCommandData>, "sendBatch">;
}>;

export type OrganizationMemberListingPage = {
  lastOrganizationId: string | null;
  organizations: number;
  /** Facts sent; a dry run counts the ones a run would send, by the same rule. */
  listed: number;
};

type Dependencies = Readonly<{
  organizations: Pick<OrganizationRepository, "findActiveMemberPage">;
}>;

/**
 * Lists active memberships, each keyed on its organization and user, so a rerun records nothing
 * new. The sender arrives once organization_lifecycle registers.
 */
export class OrganizationMemberListingService {
  #senders: OrganizationMemberListingSenders | undefined;

  private constructor(private readonly deps: Dependencies) {}

  static create(deps: Dependencies): OrganizationMemberListingService {
    return new OrganizationMemberListingService(deps);
  }

  connect(senders: OrganizationMemberListingSenders): void {
    this.#senders = senders;
  }

  /** One page after `afterOrganizationId`; throws, so the step retries the page. */
  async listPage({
    afterOrganizationId,
    limit,
    dryRun,
  }: {
    afterOrganizationId: string | null;
    limit: number;
    dryRun: boolean;
  }): Promise<OrganizationMemberListingPage> {
    // Taken before the read, so a membership change saved meanwhile is the newer fact.
    const occurredAt = nowInstant().epochMilliseconds;
    const page = await this.deps.organizations.findActiveMemberPage({
      afterId: afterOrganizationId,
      limit,
    });
    if (!dryRun && page.members.length > 0) {
      const senders = this.#senders;
      if (!senders) throw new Error("organization_lifecycle is not registered in this process");
      await senders.recordMemberListed.sendBatch(
        page.members.map(({ organizationId, userId, joinedAt }) => ({
          tenantId: organizationId,
          organizationId,
          userId,
          joinedAt: joinedAt.epochMilliseconds,
          backfilled: true as const,
          occurredAt,
        })),
      );
    }
    return {
      lastOrganizationId: page.lastOrganizationId,
      organizations: page.organizations,
      listed: page.members.length,
    };
  }
}
