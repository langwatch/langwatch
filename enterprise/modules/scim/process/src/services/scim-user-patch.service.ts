// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import type { ScimPatchOperation } from "@langwatch/enterprise-scim-contract";
import type { UserApi } from "@langwatch/user-contract";

import {
  mergeNameParts,
  namePartsIn,
  namesAName,
  type MergedScimName,
} from "../rules/scim-name.rules.ts";
import { ScimCostCenterService } from "./scim-cost-center.service.ts";
import { ScimDeprovisionService } from "./scim-deprovision.service.ts";
import { ScimUserProfileService } from "./scim-user-profile.service.ts";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/**
 * What a SCIM `active` flag turns into: the directory says a user is on or off,
 * and that is the whole of what patching asks of `UserApi`.
 */
export type ScimUserActivation = Pick<UserApi, "deactivate" | "reactivate">;

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

    if (input.operation.op !== "replace") {
      return;
    }

    if (input.operation.path === "active") {
      await this.updateActive(input, input.operation.value);

      return;
    }

    const merged = await this.mergedName(input);
    const value = isRecord(input.operation.value) ? input.operation.value : void 0;

    if (value && "active" in value) {
      await this.updateActive(input, value.active);
    }

    const email = typeof value?.userName === "string" ? value.userName : void 0;
    if (merged.changed || email !== void 0) {
      await this.profiles.updateProfile({
        id: input.id,
        ...(merged.changed ? { name: merged.name } : {}),
        ...(email !== void 0 ? { email } : {}),
      });
    }
  }

  /**
   * The stored name with whichever half this operation named merged over it —
   * a surname patch keeps the forename it did not mention. ADR-002.
   */
  private async mergedName(input: {
    id: string;
    operation: ScimPatchOperation;
  }): Promise<MergedScimName> {
    const parts = namePartsIn({
      path: input.operation.path,
      value: input.operation.value,
    });
    if (!namesAName(parts)) return { changed: false };

    return mergeNameParts({ current: await this.profiles.storedName(input.id), ...parts });
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
}
