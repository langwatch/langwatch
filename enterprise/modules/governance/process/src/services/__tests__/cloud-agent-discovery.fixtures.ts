// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/** An agent discovery service over memory twins, for the cloud discovery tests. */
import { createTestLogger } from "@langwatch/test-harness";
import { type Instant, Temporal } from "@langwatch/time";

import type { GovernanceHttpClient } from "../../channels/governance-http.channel.ts";
import { HttpCopilotBotsChannel } from "../../channels/http/http.copilot-bots.channel.ts";
import { HttpGenieSpacesChannel } from "../../channels/http/http.genie-spaces.channel.ts";
import { HttpProviderSignInChannel } from "../../channels/http/http.provider-sign-in.channel.ts";
import { MemoryArdRegistryChannel } from "../../channels/memory/memory.ard-registry.channel.ts";
import { MemoryAwsAgentInventoryChannel } from "../../channels/memory/memory.aws-agent-inventory.channel.ts";
import { MemoryVertexAgentEngineChannel } from "../../channels/memory/memory.vertex-agent-engine.channel.ts";
import {
  type AgentListing,
  type DiscoveredAgentRecord,
} from "../../features/agents/rules/agent-listing.rules.ts";
import { AgentDiscoveryService } from "../../features/agents/services/agent-discovery.service.ts";
import { SourceCredentialAccessService } from "../../features/ingestion-source/services/source-credential-access.service.ts";
import { MemoryDiscoveredAgentRepository } from "../../repositories/memory/memory.discovered-agent.repository.ts";
import { MemoryDiscoveredPeopleStore } from "../../repositories/memory/memory.discovered-people.store.ts";
import { MemoryGovernanceAwsConnectionRepository } from "../../repositories/memory/memory.governance-aws-connection.repository.ts";
import { MemoryIngestionSourceRepository } from "../../repositories/memory/memory.ingestion-source.repository.ts";

export const ACME = "org_acme";
export const OTHER = "org_other";
export const T1 = Temporal.Instant.from("2026-11-16T10:00:00.000Z");
export const T2 = Temporal.Instant.from("2026-11-16T11:00:00.000Z");
export const T3 = Temporal.Instant.from("2026-11-16T12:00:00.000Z");

export const noHttp: GovernanceHttpClient = {
  fetch: () => Promise.reject(new Error("no provider call expected")),
};

export function bedrockAgent(id: string): DiscoveredAgentRecord {
  return {
    rawAgentId: `arn:aws:bedrock:eu-west-1:111122223333:agent/${id}`,
    displayText: id,
    metadata: { platform: "aws_bedrock", model: "anthropic.claude-sonnet-5" },
  };
}

/** A registry that counts reconciles; the registry's own events are its feature's tests. */
export class CountingRegistry {
  reconciles = 0;
  async reconcileOrganization(): Promise<{ events: number }> {
    this.reconciles++;
    return { events: 0 };
  }
}

export async function cloudWorld() {
  const store = MemoryDiscoveredPeopleStore.create();
  const agents = MemoryDiscoveredAgentRepository.create(store);
  const sources = MemoryIngestionSourceRepository.create();
  const awsConnections = MemoryGovernanceAwsConnectionRepository.create();
  const aws = MemoryAwsAgentInventoryChannel.create();
  const vertex = MemoryVertexAgentEngineChannel.create();
  const ard = MemoryArdRegistryChannel.create();
  const registry = new CountingRegistry();
  const { logger } = createTestLogger();
  const service = AgentDiscoveryService.create({
    agents,
    sourceCredentials: SourceCredentialAccessService.create({ sources }),
    signIn: HttpProviderSignInChannel.create({ http: noHttp }),
    genieSpaces: HttpGenieSpacesChannel.create({ http: noHttp }),
    copilotBots: HttpCopilotBotsChannel.create({ http: noHttp }),
    awsAgentInventory: aws,
    vertexAgentEngine: vertex,
    ardRegistry: ard,
    awsConnections,
    registry,
    logger,
  });

  const connectionOf = async (organizationId: string) =>
    awsConnections.create({
      id: `awsconn_${organizationId}`,
      organizationId,
      name: "ACME prod",
      accessKeyId: "AKIAACMEEXAMPLE0001",
      secretAccessKey: "acme-secret-access-key-0001",
      roleArn: null,
      externalId: null,
      audit: {
        idempotencyKey: `audit-${organizationId}`,
        organizationId,
        action: "governance.agent.aws_connection_created",
      },
    });

  const awsSource = async ({ awsConnectionId }: { awsConnectionId: string }) =>
    sources.create({
      organizationId: ACME,
      teamId: null,
      traceProjectId: null,
      sourceType: "aws_bedrock_agents",
      name: "AWS",
      description: null,
      ingestSecretHash: "",
      parserConfig: {
        adapter: "aws_bedrock_agents",
        awsConnectionId,
        regions: ["eu-west-1", "us-east-1"],
        schedule: "0 * * * *",
      },
      pullSchedule: "0 * * * *",
      status: "awaiting_first_event",
      createdById: "user_1",
      providerAccountId: null,
    });

  const sync = ({ sourceId, now }: { sourceId: string; now: Instant }) =>
    service.syncFromSource({ organizationId: ACME, ingestionSourceId: sourceId, now });
  const listed = async () =>
    (await agents.findForRegistry({ organizationId: ACME }))
      .map((row) => row.displayText)
      .toSorted();
  const answer = (listing: AgentListing) => aws.answer({ listing });
  const presenceOf = (displayText: string) => {
    const agent = store.agents.find((row) => row.displayText === displayText);
    return store.agentListings
      .filter((listing) => listing.discoveredAgentId === agent?.id)
      .map(({ lastListedAt, goneAt }) => ({ lastListedAt, goneAt }));
  };

  return {
    service,
    store,
    aws,
    vertex,
    ard,
    registry,
    connectionOf,
    awsSource,
    sync,
    listed,
    answer,
    presenceOf,
  };
}
