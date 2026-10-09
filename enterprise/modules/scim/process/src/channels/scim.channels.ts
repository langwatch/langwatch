// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import { OrganizationApi } from "@langwatch/organization-contract";
import type { BoundApis } from "@langwatch/process";

/** Every channel bound to a module that SCIM holds, as the container hands them to the class. */
export interface ScimChannels {
  /** A deleted directory user leaves, and an unvouched account is invited, through organization. */
  readonly members: Pick<OrganizationApi, "deleteMember" | "createInvitations">;
}

/** Both tiers bind organization: a binding to a module is no peer (record §5). */
export class BoundScimChannels {
  static readonly requires = [] as const;
  static readonly binds = { members: OrganizationApi } as const;

  static create({ bound }: { bound: BoundApis<typeof BoundScimChannels.binds> }): ScimChannels {
    return { members: bound.members };
  }
}
