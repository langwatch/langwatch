// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import { OrganizationApi } from "@langwatch/organization-contract";
import { defineChannels, type BoundApis } from "@langwatch/process";

/** Every channel bound to a module that SCIM holds, as the container hands them to the class. */
export interface ScimChannels {
  /** A deleted directory user leaves through organization, which owns the membership row. */
  readonly members: Pick<OrganizationApi, "deleteMember">;
}

/** Both tiers bind organization: a binding to a module is no peer (record §5). */
class BoundScimChannels {
  static readonly requires = [] as const;
  static readonly binds = { members: OrganizationApi } as const;

  static create({ bound }: { bound: BoundApis<typeof BoundScimChannels.binds> }): ScimChannels {
    return { members: bound.members };
  }
}

/** The container builds the tier the stores state and hands it to the module class (§5). */
export const scimChannels = defineChannels({
  live: BoundScimChannels,
  memory: BoundScimChannels,
});
