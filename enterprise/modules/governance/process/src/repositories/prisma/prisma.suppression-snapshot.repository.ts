// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import {
  OperatorRead,
  type PrismaModelClient,
  type ScopedOperatorReads,
} from "@langwatch/prisma-client";

import type { ErasedIdentifierSuppressionRow } from "../erased-identifier-suppression.repository.ts";
import type { GovernanceTenantRow } from "../governance-tenant-history.repository.ts";
import { SuppressionSnapshotRepository } from "../suppression-snapshot.repository.ts";

/** Governance's declared reads across organizations, named on `GovernanceApp` (ARCHITECTURE §7). */
export const governanceOperatorReads = {
  suppressions: OperatorRead.of("ErasedIdentifierSuppression", { actions: ["findMany"] }),
  tenantHistory: OperatorRead.of("GovernanceTenantHistory", { actions: ["findMany"] }),
};

/** The member the root hands governance's live registry, scoped to the handles above. */
export type GovernanceOperatorReadsMember = Readonly<{ operatorReads: ScopedOperatorReads }>;

export class PrismaSuppressionSnapshotRepository extends SuppressionSnapshotRepository {
  private constructor(
    private readonly suppressions: PrismaModelClient<"ErasedIdentifierSuppression">,
    private readonly tenants: PrismaModelClient<"GovernanceTenantHistory">,
  ) {
    super();
  }

  static create({
    operatorReads,
  }: GovernanceOperatorReadsMember): PrismaSuppressionSnapshotRepository {
    return operatorReads.into(governanceOperatorReads.suppressions, (suppressions) =>
      operatorReads.into(
        governanceOperatorReads.tenantHistory,
        (tenants) => new PrismaSuppressionSnapshotRepository(suppressions, tenants),
      ),
    );
  }

  findAllSuppressions(): Promise<ErasedIdentifierSuppressionRow[]> {
    return this.suppressions.erasedIdentifierSuppression.findMany({
      select: { organizationId: true, provider: true, identifierHash: true },
    });
  }

  findAllTenants(): Promise<GovernanceTenantRow[]> {
    return this.tenants.governanceTenantHistory.findMany({
      select: { organizationId: true, tenantId: true },
    });
  }
}
