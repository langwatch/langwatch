// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import { peopleRefused, type PeopleListing } from "../../rules/people-listing.rules.ts";
import type { DatabricksScimUsersChannel } from "../databricks-scim-users.channel.ts";

/** SCIM in memory: a workspace answers what a test seeded, and one nothing seeded is unreachable. */
export class MemoryDatabricksScimUsersChannel implements DatabricksScimUsersChannel {
  readonly asked: string[] = [];
  private readonly listings = new Map<string, PeopleListing>();

  private constructor() {}

  static create(): MemoryDatabricksScimUsersChannel {
    return new MemoryDatabricksScimUsersChannel();
  }

  seed({ workspaceUrl, listing }: { workspaceUrl: string; listing: PeopleListing }): void {
    this.listings.set(workspaceUrl, listing);
  }

  async listPeople({ workspaceUrl }: { workspaceUrl: string }): Promise<PeopleListing> {
    this.asked.push(workspaceUrl);
    return (
      this.listings.get(workspaceUrl) ?? peopleRefused({ reason: "unreachable", status: null })
    );
  }
}
