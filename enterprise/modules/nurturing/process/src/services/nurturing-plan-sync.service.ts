// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import type { CioBatchCall, NurturingSignalOf } from "@langwatch/enterprise-nurturing-contract";

import type { NurturingOrganizationMemberRepository } from "../repositories/nurturing-organization-member.repository.ts";
import { membersWhoseLatestOrganizationIs } from "../rules/nurturing-organization-member.rules.ts";
import { fireSubscriptionSync } from "../rules/nurturing-subscription-sync-service.rules.ts";
import type { NurturingMemberFactsService } from "./nurturing-member-facts.service.ts";
import type { NurturingService } from "./nurturing.service.ts";

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
  customerIo: Pick<NurturingService, "batch" | "batchOrThrow"> | undefined;
  /** The admin who carries the company call, from nurturing's own copy. */
  admins: Pick<NurturingMemberFactsService, "adminOf">;
  /** Nurturing's member copy, the one the usage sync reads: whose latest organization is whose. */
  members: Pick<NurturingOrganizationMemberRepository, "findMembershipsOfMembers">;
}>;

type SubscriptionChanged = NurturingSignalOf<"subscription_changed">;

/**
 * Tells Customer.io an organization's plan, on its members and its company, one request after the
 * other. Spec: enterprise/modules/nurturing/specs/customer-io-plan-traits.feature
 */
export class NurturingPlanSyncService {
  static create(dependencies: PlanSyncDependencies): NurturingPlanSyncService {
    return new NurturingPlanSyncService(dependencies);
  }

  private constructor(private readonly dependencies: PlanSyncDependencies) {}

  /** A live change: a refused request only logs; a failed read of nurturing's copy rejects. */
  async planChanged(signal: SubscriptionChanged): Promise<void> {
    const customerIo = this.dependencies.customerIo;
    if (!customerIo) return;
    for (const request of await this.requestsOf(signal)) await customerIo.batch(request);
  }

  /**
   * The resync's catch-up fact, never claimed: a refused request or a missing channel throws, so
   * the subscriber's job fails and is retried or replayed, and no other organization's is touched.
   */
  async planCaughtUp(signal: SubscriptionChanged): Promise<void> {
    const customerIo = this.dependencies.customerIo;
    if (!customerIo) throw new NoCustomerIoChannelError();
    for (const request of await this.requestsOf(signal)) await customerIo.batchOrThrow(request);
  }

  private async requestsOf(signal: SubscriptionChanged): Promise<CioBatchCall[][]> {
    if (signal.memberUserIds.length === 0) return [];
    const { organizationId } = signal;
    const [adminUserId, memberships] = await Promise.all([
      this.dependencies.admins.adminOf({ organizationId }),
      this.dependencies.members.findMembershipsOfMembers({ organizationId }),
    ]);
    const latestMemberUserIds = membersWhoseLatestOrganizationIs({ memberships, organizationId });
    return fireSubscriptionSync({ ...signal, adminUserId, latestMemberUserIds });
  }
}
