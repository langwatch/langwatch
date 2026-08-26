// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import type { UserService } from "@langwatch/user-contract";
import type { ScimPatchOperation } from "@langwatch/enterprise-scim-contract";
import { ScimCostCenterService } from "./scim-cost-center.service";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** Applies the mutable SCIM User attributes without owning user lookup or output. */
export class ScimUserPatchService {
  private constructor(
    private readonly users: UserService,
    private readonly costCenters: ScimCostCenterService,
  ) {}

  static create(
    users: UserService,
    costCenters: ScimCostCenterService,
  ): ScimUserPatchService {
    return new ScimUserPatchService(users, costCenters);
  }

  async apply(input: {
    id: string;
    organizationId: string;
    operation: ScimPatchOperation;
  }): Promise<void> {
    const costCenter = this.costCenters.fromPatchOperation(input.operation);
    if (costCenter.present) {
      await this.costCenters.sync({
        userId: input.id,
        organizationId: input.organizationId,
        costCenter: costCenter.value,
      });
    }

    if (input.operation.op !== "replace") return;

    if (input.operation.path === "active") {
      await this.updateActive(input.id, input.operation.value);
      return;
    }

    if (!isRecord(input.operation.value)) return;

    const updates = this.profileUpdates(input.operation.value);
    if (updates.hasActive) {
      await this.updateActive(input.id, updates.active);
    }
    if (updates.name !== void 0 || updates.email !== void 0) {
      await this.users.updateProfile({
        id: input.id,
        ...(updates.name !== void 0 ? { name: updates.name } : {}),
        ...(updates.email !== void 0 ? { email: updates.email } : {}),
      });
    }
  }

  private async updateActive(id: string, value: unknown): Promise<void> {
    if (value === false || value === "false") {
      await this.users.deactivate({ id });
      return;
    }
    await this.users.reactivate({ id });
  }

  private profileUpdates(value: Record<string, unknown>): {
    hasActive: boolean;
    active?: unknown;
    name?: string;
    email?: string;
  } {
    const email = typeof value.userName === "string" ? value.userName : undefined;
    const name = this.readName(value);
    return {
      hasActive: "active" in value,
      ...("active" in value ? { active: value.active } : {}),
      ...(name ? { name } : {}),
      ...(email ? { email } : {}),
    };
  }

  private readName(value: Record<string, unknown>): string | undefined {
    const compoundName = value.name;
    if (isRecord(compoundName)) {
      return this.joinName(compoundName.givenName, compoundName.familyName);
    }
    return this.joinName(value["name.givenName"], value["name.familyName"]);
  }

  private joinName(givenName: unknown, familyName: unknown): string | undefined {
    const parts = [givenName, familyName].filter(
      (part): part is string => typeof part === "string" && part.length > 0,
    );
    return parts.length > 0 ? parts.join(" ") : undefined;
  }
}
