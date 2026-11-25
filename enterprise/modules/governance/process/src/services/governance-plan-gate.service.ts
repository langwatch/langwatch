// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import {
  assertEnterprisePlanType,
  ENTERPRISE_FEATURE_ERRORS,
  type EnterpriseFeature,
  type EntitlementApi,
  type EntitlementOperator,
} from "@langwatch/entitlement-contract";

/**
 * Refuses an organization whose plan does not carry one governance capability. The operator is
 * forwarded to the plan lookup, which the framework's declared gate does not do.
 */
export class GovernancePlanGateService {
  private constructor(private readonly entitlements: Pick<EntitlementApi, "getActivePlan">) {}

  static create(input: {
    entitlements: Pick<EntitlementApi, "getActivePlan">;
  }): GovernancePlanGateService {
    return new GovernancePlanGateService(input.entitlements);
  }

  async assertEnterprise({
    organizationId,
    by,
    feature,
  }: {
    organizationId: string;
    by: EntitlementOperator;
    feature: EnterpriseFeature;
  }): Promise<void> {
    const operator = by.impersonatorId
      ? { id: by.id, impersonatorId: by.impersonatorId }
      : { id: by.id };
    const plan = await this.entitlements.getActivePlan({ organizationId, operator });
    assertEnterprisePlanType({
      planType: plan.type,
      errorMessage: ENTERPRISE_FEATURE_ERRORS[feature],
    });
  }
}
