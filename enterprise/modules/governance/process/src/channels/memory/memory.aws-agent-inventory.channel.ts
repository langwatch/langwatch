// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import {
  agentsRefused,
  type AgentListing,
} from "../../features/agents/rules/agent-listing.rules.ts";
import type { GovernanceAwsCredentials } from "../../repositories/governance-aws-connection.repository.ts";
import type { AwsAgentInventoryChannel } from "../cloud-agent-inventory.channel.ts";

/** AWS in memory: answers the listing a test configured, and unreachable until one is. */
export class MemoryAwsAgentInventoryChannel implements AwsAgentInventoryChannel {
  readonly asked: { credentials: GovernanceAwsCredentials; regions: string[] }[] = [];
  private listing: AgentListing = agentsRefused({ reason: "unreachable", status: null });

  private constructor() {}

  static create(): MemoryAwsAgentInventoryChannel {
    return new MemoryAwsAgentInventoryChannel();
  }

  answer({ listing }: { listing: AgentListing }): void {
    this.listing = listing;
  }

  async listAgents({
    credentials,
    regions,
  }: {
    credentials: GovernanceAwsCredentials;
    regions: string[];
  }): Promise<AgentListing> {
    this.asked.push({ credentials, regions: [...regions] });
    return this.listing;
  }
}
