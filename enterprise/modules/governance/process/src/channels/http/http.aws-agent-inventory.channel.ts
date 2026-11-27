// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import {
  type AgentSummary,
  BedrockAgentClient,
  GetAgentCommand,
  ListAgentAliasesCommand,
  ListAgentsCommand,
  ListTagsForResourceCommand,
} from "@aws-sdk/client-bedrock-agent";
import {
  BedrockAgentCoreControlClient,
  GetAgentRuntimeCommand,
  ListAgentRuntimesCommand,
  ListTagsForResourceCommand as ListAgentCoreTagsCommand,
} from "@aws-sdk/client-bedrock-agentcore-control";
import { type AwsClientConfig, AwsClientConfiguration } from "@langwatch/aws-client";

import {
  type AgentListing,
  agentsListed,
  agentsRefused,
  type DiscoveredAgentRecord,
} from "../../features/agents/rules/agent-listing.rules.ts";
import {
  agentCoreRuntimeAsSighting,
  bedrockAgentAsSighting,
  isAwsResourceGone,
  refusalFromAwsError,
} from "../../features/agents/rules/aws-agents.rules.ts";
import type { GovernanceAwsCredentials } from "../../repositories/governance-aws-connection.repository.ts";
import type { VendorBases } from "../../rules/vendor-bases.rules.ts";
import type { AwsAgentInventoryChannel } from "../cloud-agent-inventory.channel.ts";

/** Pages one paged call will follow before the listing refuses as too_many_pages. */
const MAX_PAGES_PER_CALL = 50;
const PAGE_SIZE = 100;

class TooManyPagesError extends Error {
  override readonly name = "TooManyPagesError";
}

/** A 2xx answer missing a field the listing keys on: the listing refuses, nothing is marked gone. */
class MalformedAwsAnswerError extends Error {
  override readonly name = "MalformedAwsAnswerError";
}

/** Follows `nextToken` until the provider stops answering one, up to the page bound. */
async function allPages<T>(
  readPage: (nextToken: string | undefined) => Promise<{ items: T[]; nextToken?: string }>,
): Promise<T[]> {
  const items: T[] = [];
  let nextToken: string | undefined;
  for (let page = 0; page < MAX_PAGES_PER_CALL; page++) {
    const answer = await readPage(nextToken);
    items.push(...answer.items);
    nextToken = answer.nextToken || undefined;
    if (!nextToken) return items;
  }
  throw new TooManyPagesError("AWS listing exceeded the page bound");
}

/**
 * Bedrock Agents and AgentCore runtimes of every configured region, signed with the organisation's
 * AWS connection (a static key pair, a role assumed with its external id, or both). One refused
 * call in any region refuses the whole listing. Endpoints replace AWS's own for dogfood.
 */
export class HttpAwsAgentInventoryChannel implements AwsAgentInventoryChannel {
  // Reached directly, never through the platform's outbound proxy, as the Bedrock kill switch is.
  readonly #aws = AwsClientConfiguration.create({
    outboundProxy: { tryResolveForHost: () => undefined },
  });

  private constructor(
    private readonly endpoints: Pick<VendorBases, "bedrockAgent" | "bedrockAgentCoreControl">,
  ) {}

  static create({
    vendorBases,
  }: {
    vendorBases: Pick<VendorBases, "bedrockAgent" | "bedrockAgentCoreControl">;
  }): HttpAwsAgentInventoryChannel {
    return new HttpAwsAgentInventoryChannel(vendorBases);
  }

  async listAgents({
    credentials,
    regions,
    signal,
  }: {
    credentials: GovernanceAwsCredentials;
    regions: string[];
    signal?: AbortSignal;
  }): Promise<AgentListing> {
    // With neither a key pair nor a role, the SDK would sign as the deployment itself.
    const hasKeyPair = Boolean(credentials.accessKeyId && credentials.secretAccessKey);
    if (!hasKeyPair && !credentials.roleArn) {
      return agentsRefused({ reason: "not_configured", status: null });
    }
    try {
      const agents: DiscoveredAgentRecord[] = [];
      for (const region of regions) {
        agents.push(...(await this.listBedrockAgents({ credentials, region, signal })));
        agents.push(...(await this.listAgentCoreRuntimes({ credentials, region, signal })));
      }
      return agentsListed(agents);
    } catch (error) {
      if (error instanceof TooManyPagesError) {
        return agentsRefused({ reason: "too_many_pages", status: null });
      }
      if (error instanceof MalformedAwsAnswerError) {
        return agentsRefused({ reason: "malformed_response", status: null });
      }
      return agentsRefused(refusalFromAwsError(error));
    }
  }

  private async listBedrockAgents({
    credentials,
    region,
    signal,
  }: {
    credentials: GovernanceAwsCredentials;
    region: string;
    signal: AbortSignal | undefined;
  }): Promise<DiscoveredAgentRecord[]> {
    const client = new BedrockAgentClient(
      this.configFor({
        credentials,
        region,
        endpoint: this.endpoints.bedrockAgent,
        defaultHost: `bedrock-agent.${region}.amazonaws.com`,
      }),
    );
    const options = { abortSignal: signal };
    try {
      const summaries = await allPages(async (nextToken) => {
        const page = await client.send(
          new ListAgentsCommand({ maxResults: PAGE_SIZE, nextToken }),
          options,
        );
        return { items: page.agentSummaries ?? [], nextToken: page.nextToken };
      });
      const sightings: DiscoveredAgentRecord[] = [];
      for (const summary of summaries) {
        sightings.push(...(await this.readBedrockAgent({ client, region, summary, signal })));
      }
      return sightings;
    } finally {
      client.destroy();
    }
  }

  /** One listed agent with its model, aliases and tags; none when it was deleted mid-walk. */
  private async readBedrockAgent({
    client,
    region,
    summary,
    signal,
  }: {
    client: BedrockAgentClient;
    region: string;
    summary: AgentSummary;
    signal: AbortSignal | undefined;
  }): Promise<DiscoveredAgentRecord[]> {
    const agentId = summary.agentId;
    if (!agentId) return [];
    const options = { abortSignal: signal };
    try {
      const { agent } = await client.send(new GetAgentCommand({ agentId }), options);
      const agentArn = agent?.agentArn;
      if (!agentArn) throw new MalformedAwsAnswerError("GetAgent answered without an agentArn");
      const aliases = await allPages(async (nextToken) => {
        const page = await client.send(
          new ListAgentAliasesCommand({ agentId, maxResults: PAGE_SIZE, nextToken }),
          options,
        );
        return { items: page.agentAliasSummaries ?? [], nextToken: page.nextToken };
      });
      const { tags } = await client.send(
        new ListTagsForResourceCommand({ resourceArn: agentArn }),
        options,
      );
      return [
        bedrockAgentAsSighting({
          region,
          agentId,
          agentName: agent.agentName ?? summary.agentName,
          agentArn,
          agentStatus: agent.agentStatus ?? summary.agentStatus,
          foundationModel: agent.foundationModel,
          createdAt: agent.createdAt?.toISOString(),
          updatedAt: (agent.updatedAt ?? summary.updatedAt)?.toISOString(),
          aliasIds: aliases.flatMap((alias) => (alias.agentAliasId ? [alias.agentAliasId] : [])),
          tags: tags ?? {},
        }),
      ];
    } catch (error) {
      // Deleted between ListAgents and its own reads: no longer an agent of this account.
      if (isAwsResourceGone(error)) return [];
      throw error;
    }
  }

  private async listAgentCoreRuntimes({
    credentials,
    region,
    signal,
  }: {
    credentials: GovernanceAwsCredentials;
    region: string;
    signal: AbortSignal | undefined;
  }): Promise<DiscoveredAgentRecord[]> {
    const client = new BedrockAgentCoreControlClient(
      this.configFor({
        credentials,
        region,
        endpoint: this.endpoints.bedrockAgentCoreControl,
        defaultHost: `bedrock-agentcore-control.${region}.amazonaws.com`,
      }),
    );
    const options = { abortSignal: signal };
    try {
      const runtimes = await allPages(async (nextToken) => {
        const page = await client.send(
          new ListAgentRuntimesCommand({ maxResults: PAGE_SIZE, nextToken }),
          options,
        );
        return { items: page.agentRuntimes ?? [], nextToken: page.nextToken };
      });
      const sightings: DiscoveredAgentRecord[] = [];
      for (const runtime of runtimes) {
        const agentRuntimeArn = runtime.agentRuntimeArn;
        if (!agentRuntimeArn) continue;
        try {
          const { tags } = await client.send(
            new ListAgentCoreTagsCommand({ resourceArn: agentRuntimeArn }),
            options,
          );
          const { createdAt } = runtime.agentRuntimeId
            ? await client.send(
                new GetAgentRuntimeCommand({ agentRuntimeId: runtime.agentRuntimeId }),
                options,
              )
            : { createdAt: undefined };
          sightings.push(
            agentCoreRuntimeAsSighting({
              region,
              agentRuntimeArn,
              agentRuntimeId: runtime.agentRuntimeId,
              agentRuntimeName: runtime.agentRuntimeName,
              status: runtime.status,
              createdAt: createdAt?.toISOString(),
              lastUpdatedAt: runtime.lastUpdatedAt?.toISOString(),
              tags: tags ?? {},
            }),
          );
        } catch (error) {
          if (isAwsResourceGone(error)) continue;
          throw error;
        }
      }
      return sightings;
    } finally {
      client.destroy();
    }
  }

  private configFor({
    credentials,
    region,
    endpoint,
    defaultHost,
  }: {
    credentials: GovernanceAwsCredentials;
    region: string;
    endpoint: string | undefined;
    defaultHost: string;
  }): AwsClientConfig {
    return this.#aws.build({
      region,
      endpoint,
      targetHost: endpoint ? new URL(endpoint).host : defaultHost,
      staticCredentials: {
        accessKeyId: credentials.accessKeyId,
        secretAccessKey: credentials.secretAccessKey,
      },
      assumeRole: credentials.roleArn
        ? {
            roleArn: credentials.roleArn,
            externalId: credentials.externalId,
            sessionName: "langwatch-agent-discovery",
          }
        : null,
    });
  }
}
