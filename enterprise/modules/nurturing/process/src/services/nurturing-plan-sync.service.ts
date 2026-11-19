// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import type { CioBatchCall, NurturingSignalOf } from "@langwatch/enterprise-nurturing-contract";
import { createLogger } from "@langwatch/observability";

import type { NurturingOrganizationMemberRepository } from "../repositories/nurturing-organization-member.repository.ts";
import {
  type NurturingMembership,
  membersWhoseLatestOrganizationIsElsewhere,
} from "../rules/nurturing-organization-member.rules.ts";
import { fireSubscriptionSync } from "../rules/nurturing-subscription-sync-service.rules.ts";
import type { NurturingMemberFactsService } from "./nurturing-member-facts.service.ts";
import type { NurturingService } from "./nurturing.service.ts";

const logger = createLogger("langwatch:nurturing:plan-sync");

/** A catch-up fact reached a deployment with no Customer.io key; it fails so it can be replayed. */
export class NoCustomerIoChannelError extends Error {
  readonly code = "no_customer_io_channel";

  constructor() {
    super("no_customer_io_channel: this deployment names no Customer.io key");
    this.name = "NoCustomerIoChannelError";
  }
}

type PlanSyncDependencies = Readonly<{
  /** Absent where the deployment named no Customer.io key. */
  customerIo: Pick<NurturingService, "batchOrThrow"> | undefined;
  /** The admin who carries the company call, from nurturing's own copy. */
  admins: Pick<NurturingMemberFactsService, "adminOf">;
  /** The same member copy the usage sync reads, read here by person: whose latest org is whose. */
  members: Pick<NurturingOrganizationMemberRepository, "findMembershipsOfUsers">;
}>;

type SubscriptionChanged = NurturingSignalOf<"subscription_changed">;

/**
 * Tells Customer.io an organization's plan, on its members and its company, one request after the
 * other. Which fact is told is the plan fold's to decide: it hands over only the fact that won
 * nurturing's plan copy. Spec: enterprise/modules/nurturing/specs/customer-io-plan-traits.feature
 */
export class NurturingPlanSyncService {
  static create(dependencies: PlanSyncDependencies): NurturingPlanSyncService {
    return new NurturingPlanSyncService(dependencies);
  }

  private constructor(private readonly dependencies: PlanSyncDependencies) {}

  /**
   * A live change: with no channel it is dropped quietly; a refused request or a failed read of
   * nurturing's member copy rejects, so the caller gives its claim back and the job's retry sends
   * it.
   */
  async planChanged(signal: SubscriptionChanged): Promise<void> {
    const customerIo = this.dependencies.customerIo;
    if (!customerIo) return;
    await this.send(signal, customerIo);
  }

  /**
   * The resync's catch-up fact, never claimed: a refused request or a missing channel throws, so
   * the subscriber's job fails and is retried or replayed, and no other organization's is touched.
   */
  async planCaughtUp(signal: SubscriptionChanged): Promise<void> {
    const customerIo = this.dependencies.customerIo;
    if (!customerIo) throw new NoCustomerIoChannelError();
    await this.send(signal, customerIo);
  }

  /** An organization with no active member has nobody to tell. */
  private async send(
    signal: SubscriptionChanged,
    customerIo: Pick<NurturingService, "batchOrThrow">,
  ): Promise<void> {
    if (signal.memberUserIds.length === 0) return;
    for (const request of await this.requestsOf(signal)) await customerIo.batchOrThrow(request);
  }

  private async requestsOf(signal: SubscriptionChanged): Promise<CioBatchCall[][]> {
    const { organizationId, memberUserIds } = signal;
    // Read by person: a member with no row here may still be current in another organization.
    const [admin, memberships] = await Promise.all([
      this.dependencies.admins.adminOf({ organizationId }),
      this.dependencies.members.findMembershipsOfUsers({ userIds: memberUserIds }),
    ]);
    const elsewhereMemberUserIds = membersWhoseLatestOrganizationIsElsewhere({
      memberships,
      organizationId,
    });
    // A catch-up fact is only trusted for members the copy holds a row for (any row, even a stale
    // leave): until the member replay step fills the copy, a paid-team member with their own free
    // org would be told free. Live facts keep identifying every member.
    const noCopyRowMemberUserIds = signal.fromCatchUp
      ? this.membersWithoutCopyRow({ memberships, memberUserIds, organizationId })
      : [];
    if (noCopyRowMemberUserIds.length > 0) {
      logger.info(
        { organizationId, skippedMembers: noCopyRowMemberUserIds.length },
        "catch-up skipped members with no member-copy row; nurturing:replay-organization-members fills it",
      );
    }
    return fireSubscriptionSync({
      ...signal,
      admin,
      skippedMemberUserIds: [...elsewhereMemberUserIds, ...noCopyRowMemberUserIds],
    });
  }

  private membersWithoutCopyRow({
    memberships,
    memberUserIds,
    organizationId,
  }: Readonly<{
    memberships: readonly NurturingMembership[];
    memberUserIds: readonly string[];
    organizationId: string;
  }>): string[] {
    const withRow = new Set(
      memberships
        .filter((membership) => membership.organizationId === organizationId)
        .map(({ userId }) => userId),
    );
    return memberUserIds.filter((userId) => !withRow.has(userId));
  }
}
