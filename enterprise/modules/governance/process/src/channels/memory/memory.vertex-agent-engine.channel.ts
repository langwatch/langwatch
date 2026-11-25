// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import type { VertexAgentEngineTarget } from "@langwatch/enterprise-governance-contract";

import {
  agentsRefused,
  type AgentListing,
} from "../../features/agents/rules/agent-listing.rules.ts";
import type { VertexAgentEngineChannel } from "../cloud-agent-inventory.channel.ts";

/** Vertex AI in memory: answers the listing a test configured, and unreachable until one is. */
export class MemoryVertexAgentEngineChannel implements VertexAgentEngineChannel {
  readonly asked: { serviceAccountJson: string; targets: VertexAgentEngineTarget[] }[] = [];
  private listing: AgentListing = agentsRefused({ reason: "unreachable", status: null });

  private constructor() {}

  static create(): MemoryVertexAgentEngineChannel {
    return new MemoryVertexAgentEngineChannel();
  }

  answer({ listing }: { listing: AgentListing }): void {
    this.listing = listing;
  }

  async listAgents({
    serviceAccountJson,
    targets,
  }: {
    serviceAccountJson: string;
    targets: VertexAgentEngineTarget[];
  }): Promise<AgentListing> {
    this.asked.push({ serviceAccountJson, targets: [...targets] });
    return this.listing;
  }
}
