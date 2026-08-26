// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import type { GovernanceService } from "@langwatch/enterprise-governance-contract";
import {
  SCIM_ENTERPRISE_USER_SCHEMA,
  type ScimCreateUserRequest,
  type ScimPatchOperation,
} from "@langwatch/enterprise-scim-contract";

/** Applies SCIM cost-center attributes through Governance's department owner. */
export class ScimCostCenterService {
  private constructor(private readonly governance: GovernanceService) {}

  static create(governance: GovernanceService): ScimCostCenterService {
    return new ScimCostCenterService(governance);
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
    const departmentId =
      trimmed === ""
        ? null
        : (
            await this.governance.departmentResolveByNameOrCreate({
              organizationId: input.organizationId,
              name: trimmed,
            })
          ).id;

    await this.governance.departmentAssignUser({
      organizationId: input.organizationId,
      userId: input.userId,
      departmentId,
    });
  }

  tryFromRequest(request: ScimCreateUserRequest): string | null | undefined {
    const extension = Reflect.get(request, SCIM_ENTERPRISE_USER_SCHEMA);
    if (
      extension === null ||
      typeof extension !== "object" ||
      !("costCenter" in extension)
    ) {
      return undefined;
    }
    const costCenter = Reflect.get(extension, "costCenter");
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

    if (operation.value != null && typeof operation.value === "object") {
      const extension = Reflect.get(operation.value, SCIM_ENTERPRISE_USER_SCHEMA);
      if (extension && typeof extension === "object" && "costCenter" in extension) {
        const costCenter = Reflect.get(extension, "costCenter");
        return {
          present: true,
          value: typeof costCenter === "string" ? costCenter : null,
        };
      }
    }

    return { present: false };
  }
}
