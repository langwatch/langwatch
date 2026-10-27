// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import type { ScimCostCenterChangedEventData } from "@langwatch/enterprise-scim-contract";

import type { GovernanceModule } from "../app/governance.app.ts";

export type ScimCostCenterDepartments = Pick<
  GovernanceModule,
  "departmentResolveByNameOrCreate" | "departmentAssignUser"
>;

type ScimCostCenterFact = Pick<
  ScimCostCenterChangedEventData,
  "organizationId" | "userId" | "costCenter"
>;

/**
 * SCIM's cost-center fact, landed as the member's department from governance's side (§9).
 * A named cost center resolves (or creates) its department; null clears it. Both writes
 * converge, so a redelivered fact changes nothing. Spec: specs/ai-gateway/governance/departments.feature
 */
export function assignScimCostCenterDepartment({
  departments,
}: {
  departments: ScimCostCenterDepartments;
}): (fact: ScimCostCenterFact) => Promise<void> {
  return async ({ organizationId, userId, costCenter }) => {
    const departmentId =
      costCenter === null
        ? null
        : (await departments.departmentResolveByNameOrCreate({ organizationId, name: costCenter }))
            .id;
    await departments.departmentAssignUser({ organizationId, userId, departmentId });
  };
}
