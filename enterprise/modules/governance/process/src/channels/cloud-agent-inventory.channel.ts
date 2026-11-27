// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import type { VertexAgentEngineTarget } from "@langwatch/enterprise-governance-contract";

import type { AgentListing } from "../features/agents/rules/agent-listing.rules.ts";
import type { GovernanceAwsCredentials } from "../repositories/governance-aws-connection.repository.ts";

/** Bedrock Agents and AgentCore runtimes of every region, signed with one AWS connection. Never throws. */
export interface AwsAgentInventoryChannel {
  listAgents(args: {
    credentials: GovernanceAwsCredentials;
    regions: string[];
    signal?: AbortSignal;
  }): Promise<AgentListing>;
}

/** Vertex AI Agent Engine reasoning engines of every project and location. Never throws. */
export interface VertexAgentEngineChannel {
  listAgents(args: {
    serviceAccountJson: string;
    targets: VertexAgentEngineTarget[];
    signal?: AbortSignal;
  }): Promise<AgentListing>;
}

/** The urn:air entries an ARD v0.91 registry publishes, from its manifest and search. Never throws. */
export interface ArdRegistryChannel {
  listAgents(args: {
    registryUrl: string;
    searchUrl?: string;
    bearerToken?: string;
    signal?: AbortSignal;
  }): Promise<AgentListing>;
}
