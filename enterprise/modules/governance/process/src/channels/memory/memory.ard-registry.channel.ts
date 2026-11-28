// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import {
  agentsRefused,
  type AgentListing,
} from "../../features/agents/rules/agent-listing.rules.ts";
import type { ArdRegistryChannel } from "../cloud-agent-inventory.channel.ts";

/** An ARD registry in memory: answers the listing a test configured, and unreachable until one is. */
export class MemoryArdRegistryChannel implements ArdRegistryChannel {
  readonly asked: { registryUrl: string; searchUrl?: string; bearerToken?: string }[] = [];
  private listing: AgentListing = agentsRefused({ reason: "unreachable", status: null });

  private constructor() {}

  static create(): MemoryArdRegistryChannel {
    return new MemoryArdRegistryChannel();
  }

  answer({ listing }: { listing: AgentListing }): void {
    this.listing = listing;
  }

  async listAgents({
    registryUrl,
    searchUrl,
    bearerToken,
  }: {
    registryUrl: string;
    searchUrl?: string;
    bearerToken?: string;
  }): Promise<AgentListing> {
    this.asked.push({
      registryUrl,
      ...(searchUrl ? { searchUrl } : {}),
      ...(bearerToken ? { bearerToken } : {}),
    });
    return this.listing;
  }
}
