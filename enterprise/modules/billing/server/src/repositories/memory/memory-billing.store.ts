// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import type { Instant } from "@langwatch/time";
import type { BillingCheckpoint } from "../../ports/billing-checkpoint.port.ts";
import type { BillingSubscriptionRecord } from "../subscription.repository.ts";
import type { NurturingProfile } from "../nurturing-profile.repository.ts";

/** An organization as every billing row in the memory tier sees it. */
export type MemoryBillingOrganization = {
  id: string;
  name: string;
  stripeCustomerId: string | null;
  pricingModel: string | null;
  currency: string | null;
  license: string | null;
  teamIds: string[];
  signupData: Record<string, unknown>;
};

/** A person the nurturing profile reads, and the seat that names them. */
export type MemoryBillingUser = {
  id: string;
  organizationId: string;
  email: string | null;
  name: string | null;
  createdAt: Instant;
  hasTraces: boolean;
};

/**
 * One store behind the billing memory tier, the way one Postgres schema serves
 * the Prisma tier: a subscription written through `subscriptions` is what the
 * report, the pricing and the nurturing rows answer from.
 */
export class MemoryBillingStore {
  readonly organizations = new Map<string, MemoryBillingOrganization>();
  readonly subscriptions: BillingSubscriptionRecord[] = [];
  readonly checkpoints = new Map<string, BillingCheckpoint>();
  readonly organizationOfTenant = new Map<string, string>();
  readonly users = new Map<string, MemoryBillingUser>();

  static create(): MemoryBillingStore {
    return new MemoryBillingStore();
  }

  /** The key a checkpoint is stored under; one row per organization month. */
  static checkpointKey(input: { organizationId: string; billingMonth: string }): string {
    return `${input.organizationId}:${input.billingMonth}`;
  }

  /** The profile facts a lifecycle signal reads, or null where the seat is gone. */
  profileOf(userId: string): NurturingProfile | null {
    const user = this.users.get(userId);
    const organization = user ? this.organizations.get(user.organizationId) : void 0;
    if (!user || !organization) return null;

    return {
      user: { id: user.id, email: user.email, name: user.name, createdAt: user.createdAt },
      organization: {
        id: organization.id,
        name: organization.name,
        signupData: organization.signupData,
      },
      hasTraces: user.hasTraces,
      hasSubscription: this.subscriptions.some(
        (subscription) => subscription.organizationId === organization.id,
      ),
    };
  }
}
