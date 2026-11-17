// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import type { CioBatchCall } from "@langwatch/enterprise-nurturing-contract";
import type { OrganizationCreatedEventData } from "@langwatch/organization-contract";

import { companyTraits } from "../rules/nurturing-company-traits.rules.ts";

type OrganizationCreatedDependencies = Readonly<{
  /** Rejects when Customer.io did not take the call, so the subscriber's job retries. */
  sendBatch: (calls: CioBatchCall[]) => Promise<void>;
  /** Lines carry counts and reasons only, never an organization or user id. */
  logger: Readonly<{ info(payload: Readonly<Record<string, unknown>>, message: string): void }>;
}>;

/**
 * Names every new organization in Customer.io on its founder, sign-ups included: its name and
 * creation time, and no plan, so a replay or retry never resets a paying one's plan. A provisioned
 * one names no founder, so nothing carries the call.
 * Spec: customer-io-plan-traits.feature
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
        traits: { name: organizationName, ...created },
      },
    ]);
  }

  private skipped(reason: "no_founder"): void {
    this.dependencies.logger.info(
      { organizations: 1, reason },
      "nurturing organization created sync skipped",
    );
  }
}
