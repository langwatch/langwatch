// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import { agentsRefused, type AgentListing } from "../../rules/agent-listing.rules.ts";
import type { GenieSpacesChannel } from "../genie-spaces.channel.ts";

/** Genie in memory: a workspace answers what a test seeded, and one nothing seeded is unreachable. */
export class MemoryGenieSpacesChannel implements GenieSpacesChannel {
  readonly asked: string[] = [];
  private readonly listings = new Map<string, AgentListing>();

  private constructor() {}

  static create(): MemoryGenieSpacesChannel {
    return new MemoryGenieSpacesChannel();
  }

  seed({ workspaceUrl, listing }: { workspaceUrl: string; listing: AgentListing }): void {
    this.listings.set(workspaceUrl, listing);
  }

  async listAgents({ workspaceUrl }: { workspaceUrl: string }): Promise<AgentListing> {
    this.asked.push(workspaceUrl);
    return (
      this.listings.get(workspaceUrl) ?? agentsRefused({ reason: "unreachable", status: null })
    );
  }
}
