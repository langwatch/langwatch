// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import type { CioBatchCall } from "@langwatch/enterprise-nurturing-contract";
import type { OrganizationCreatedEventData } from "@langwatch/organization-contract";
import { type Instant, nowInstant } from "@langwatch/time";

import { companyTraits } from "../rules/nurturing-company-traits.rules.ts";

/** Older than this, the fact is a replay: a paying organization must not be reset to free. */
export const ORGANIZATION_CREATED_STALE_AFTER_MS = 24 * 60 * 60 * 1000;

type OrganizationCreatedDependencies = Readonly<{
  /** Rejects when Customer.io did not take the call, so the subscriber's job retries. */
  sendBatch: (calls: CioBatchCall[]) => Promise<void>;
  /** Lines carry counts and reasons only, never an organization or user id. */
  logger: Readonly<{ info(payload: Readonly<Record<string, unknown>>, message: string): void }>;
  /** The clock the stale check reads; the system clock by default. */
  now?: () => Instant;
}>;

/**
 * Names a new organization in Customer.io on its founder: its name, the free plan every new one
 * starts on, and its creation time. Covers organizations created without a sign-up. A provisioned
 * one names no founder, so nothing carries the call. Spec: customer-io-plan-traits.feature
 */
export class NurturingOrganizationCreatedService {
  static create(
    dependencies: OrganizationCreatedDependencies,
  ): NurturingOrganizationCreatedService {
    return new NurturingOrganizationCreatedService(dependencies);
  }

  private constructor(private readonly dependencies: OrganizationCreatedDependencies) {}

  async organizationCreated(data: OrganizationCreatedEventData): Promise<void> {
    const { organizationId, organizationName, userId, occurredAt } = data;
    if (!userId) return this.skipped("no_founder");
    const now = (this.dependencies.now ?? nowInstant)().epochMilliseconds;
    if (now - occurredAt > ORGANIZATION_CREATED_STALE_AFTER_MS) return this.skipped("stale");
    const created = companyTraits({
      memberCount: null,
      projectCount: null,
      organizationCreatedAt: occurredAt,
    });
    await this.dependencies.sendBatch([
      {
        type: "group",
        userId,
        groupId: organizationId,
        traits: { name: organizationName, plan: "free", ...created },
      },
    ]);
  }

  private skipped(reason: "no_founder" | "stale"): void {
    this.dependencies.logger.info(
      { organizations: 1, reason },
      "nurturing organization created sync skipped",
    );
  }
}
