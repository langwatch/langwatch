// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import type { PeopleListing } from "../rules/people-listing.rules.ts";

/** Asking a Databricks workspace for its whole user list over SCIM. Never throws. */
export interface DatabricksScimUsersChannel {
  listPeople(args: {
    workspaceUrl: string;
    token: string;
    signal?: AbortSignal;
  }): Promise<PeopleListing>;
}
