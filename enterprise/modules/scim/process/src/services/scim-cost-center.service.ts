// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import {
  SCIM_ENTERPRISE_USER_SCHEMA,
  type ScimCreateUserRequest,
  type ScimPatchOperation,
} from "@langwatch/enterprise-scim-contract";

import type { ScimCostCenterFactsService } from "./scim-cost-center-facts.service.ts";

/** Where SCIM records a member's cost center; governance assigns the department from its side. */
export type ScimCostCenterFacts = Pick<ScimCostCenterFactsService, "recordCostCenterChanged">;

/** Records SCIM cost-center attributes as facts; a blank one clears the department. */
export class ScimCostCenterService {
  private constructor(private readonly facts: ScimCostCenterFacts) {}

  static create(facts: ScimCostCenterFacts): ScimCostCenterService {
    return new ScimCostCenterService(facts);
  }

  async sync(input: {
    userId: string;
    organizationId: string;
    costCenter: string | null | undefined;
  }): Promise<void> {
    if (input.costCenter === undefined) {
      return;
    }

    const trimmed = typeof input.costCenter === "string" ? input.costCenter.trim() : "";
    await this.facts.recordCostCenterChanged({
      organizationId: input.organizationId,
      userId: input.userId,
      costCenter: trimmed === "" ? null : trimmed,
    });
  }

  findFromRequest(request: ScimCreateUserRequest): string | null | undefined {
    const extension = request[SCIM_ENTERPRISE_USER_SCHEMA];
    if (extension === null || typeof extension !== "object" || !("costCenter" in extension)) {
      return undefined;
    }

    const costCenter = extension.costCenter;

    return typeof costCenter === "string" ? costCenter : null;
  }

  fromPatchOperation(
    operation: ScimPatchOperation,
  ): { present: true; value: string | null } | { present: false } {
    const costCenterPath = `${SCIM_ENTERPRISE_USER_SCHEMA}:costCenter`;

    if (operation.path === costCenterPath) {
      if (operation.op === "remove") {
        return { present: true, value: null };
      }

      return {
        present: true,
        value: typeof operation.value === "string" ? operation.value : null,
      };
    }

    const value = operation.value;
    if (value != null && typeof value === "object" && SCIM_ENTERPRISE_USER_SCHEMA in value) {
      const extension = value[SCIM_ENTERPRISE_USER_SCHEMA];
      if (extension && typeof extension === "object" && "costCenter" in extension) {
        const costCenter = extension.costCenter;

        return {
          present: true,
          value: typeof costCenter === "string" ? costCenter : null,
        };
      }
    }

    return { present: false };
  }
}
