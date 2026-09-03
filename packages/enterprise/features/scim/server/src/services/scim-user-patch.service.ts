// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import type { UserService } from "@langwatch/user-contract";
import type { ScimPatchOperation } from "@langwatch/enterprise-scim-contract";
import { ScimCostCenterService } from "./scim-cost-center.service";
import { ScimDeprovisionService } from "./scim-deprovision.service";
import { ScimUserProfileService } from "./scim-user-profile.service";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/**
 * What a SCIM `active` flag turns into: the directory says a user is on or off,
 * and that is the whole of what patching asks of `UserService`.
 */
export type ScimUserActivation = Pick<UserService, "deactivate" | "reactivate">;

/** Applies the mutable SCIM User attributes without owning user lookup or output. */
export class ScimUserPatchService {
  private constructor(
    private readonly users: ScimUserActivation,
    private readonly profiles: ScimUserProfileService,
    private readonly costCenters: ScimCostCenterService,
    private readonly deprovision: ScimDeprovisionService,
    private readonly provenOffboarding: boolean,
  ) {}

  static create(
    users: ScimUserActivation,
    profiles: ScimUserProfileService,
    costCenters: ScimCostCenterService,
    deprovision: ScimDeprovisionService,
    provenOffboarding: boolean,
  ): ScimUserPatchService {
    return new ScimUserPatchService(users, profiles, costCenters, deprovision, provenOffboarding);
  }

  async apply(input: {
    id: string;
    organizationId: string;
    connectionId: string | null;
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
      await this.updateActive(input, input.operation.value);
      return;
    }

    if (!isRecord(input.operation.value)) return;

    const updates = this.profileUpdates(input.operation.value);
    if (updates.hasActive) {
      await this.updateActive(input, updates.active);
    }
    if (updates.name !== void 0 || updates.email !== void 0) {
      await this.profiles.updateProfile({
        id: input.id,
        ...(updates.name !== void 0 ? { name: updates.name } : {}),
        ...(updates.email !== void 0 ? { email: updates.email } : {}),
      });
    }
  }

  private async updateActive(
    input: {
      id: string;
      organizationId: string;
      connectionId: string | null;
    },
    value: unknown,
  ): Promise<void> {
    if (value === false || value === "false") {
      if (this.provenOffboarding) {
        await this.deprovision.removeAccess({
          userId: input.id,
          organizationId: input.organizationId,
          connectionId: input.connectionId,
          op: "deactivate_user",
        });
      }
      await this.users.deactivate({ id: input.id });
      return;
    }
    await this.users.reactivate({ id: input.id });
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
