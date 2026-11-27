// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * Bedrock Agents and Bedrock AgentCore runtimes as agent sightings, and AWS SDK errors as listing
 * refusals. Pure: the SDK walk lives in the http AWS agent inventory channel.
 * Spec: enterprise/modules/governance/specs/cloud-agent-discovery.feature
 */

import type { DiscoveredAgentRecord } from "./agent-listing.rules.ts";
import { definedMetadata, ownerLabelOf } from "./cloud-agent-metadata.rules.ts";
import {
  type ListingRefusal,
  refusalFromStatus,
  refusalFromThrown,
} from "./provider-listing.rules.ts";

export interface BedrockAgentFacts {
  region: string;
  agentId: string;
  agentName?: string | undefined;
  agentArn: string;
  agentStatus?: string | undefined;
  foundationModel?: string | undefined;
  /** ISO text off the wire. */
  createdAt?: string | undefined;
  updatedAt?: string | undefined;
  aliasIds: string[];
  tags: Record<string, string>;
}

export interface AgentCoreRuntimeFacts {
  region: string;
  agentRuntimeArn: string;
  agentRuntimeId?: string | undefined;
  agentRuntimeName?: string | undefined;
  status?: string | undefined;
  /** ISO text off the wire, from GetAgentRuntime: the listing summary carries none. */
  createdAt?: string | undefined;
  lastUpdatedAt?: string | undefined;
  tags: Record<string, string>;
}

/** `arn:aws:bedrock:<region>:<account>:agent/<id>` names each alias as `agent-alias/<id>/<aliasId>`. */
export function bedrockAliasArns({
  agentArn,
  agentId,
  aliasIds,
}: {
  agentArn: string;
  agentId: string;
  aliasIds: string[];
}): string[] {
  const suffix = `:agent/${agentId}`;
  if (!agentArn.endsWith(suffix)) return [];
  const prefix = agentArn.slice(0, -suffix.length);
  return aliasIds.map((aliasId) => `${prefix}:agent-alias/${agentId}/${aliasId}`);
}

export function bedrockAgentConsoleUrl({
  region,
  agentId,
}: {
  region: string;
  agentId: string;
}): string {
  return `https://${region}.console.aws.amazon.com/bedrock/home?region=${region}#/agents/${agentId}`;
}

/** Every Bedrock agent's test alias carries this id, so the bare id names no single agent. */
const BEDROCK_TEST_ALIAS_ID = "TSTALIASID";

export function bedrockAgentAsSighting(agent: BedrockAgentFacts): DiscoveredAgentRecord {
  const aliasArns = bedrockAliasArns({
    agentArn: agent.agentArn,
    agentId: agent.agentId,
    aliasIds: agent.aliasIds,
  });
  const scopedAliasIds = agent.aliasIds.filter((aliasId) => aliasId !== BEDROCK_TEST_ALIAS_ID);
  const matchIds = [...new Set([agent.agentId, ...scopedAliasIds, ...aliasArns, agent.agentArn])];
  return {
    rawAgentId: agent.agentArn,
    displayText: agent.agentName || agent.agentId,
    metadata: definedMetadata({
      platform: "aws_bedrock",
      model: agent.foundationModel,
      owner: ownerLabelOf({ labels: agent.tags }),
      tags: JSON.stringify(agent.tags),
      region: agent.region,
      createdAt: agent.createdAt,
      updatedAt: agent.updatedAt,
      status: agent.agentStatus,
      matchIds: JSON.stringify(matchIds),
      consoleUrl: bedrockAgentConsoleUrl({ region: agent.region, agentId: agent.agentId }),
    }),
  };
}

export function agentCoreRuntimeAsSighting(runtime: AgentCoreRuntimeFacts): DiscoveredAgentRecord {
  const matchIds = [
    ...new Set(
      [runtime.agentRuntimeId, runtime.agentRuntimeArn].filter(
        (id): id is string => typeof id === "string" && id !== "",
      ),
    ),
  ];
  return {
    rawAgentId: runtime.agentRuntimeArn,
    displayText: runtime.agentRuntimeName || runtime.agentRuntimeId || runtime.agentRuntimeArn,
    metadata: definedMetadata({
      platform: "aws_agentcore",
      owner: ownerLabelOf({ labels: runtime.tags }),
      tags: JSON.stringify(runtime.tags),
      region: runtime.region,
      createdAt: runtime.createdAt,
      updatedAt: runtime.lastUpdatedAt,
      status: runtime.status,
      matchIds: JSON.stringify(matchIds),
    }),
  };
}

const UNAUTHORIZED_ERROR_NAMES = new Set([
  "AccessDeniedException",
  "AccessDenied",
  "UnrecognizedClientException",
  "InvalidSignatureException",
  "ExpiredToken",
  "ExpiredTokenException",
  "InvalidClientTokenId",
]);

/** The SDK error of one AWS call as a refusal. Only the name and status travel, never the message. */
export function refusalFromAwsError(error: unknown): ListingRefusal {
  if (!(error instanceof Error)) return refusalFromThrown(error);
  const status = (error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode;
  const knownStatus = typeof status === "number" ? status : null;
  if (UNAUTHORIZED_ERROR_NAMES.has(error.name)) {
    return { reason: "unauthorized", status: knownStatus };
  }
  if (error.name === "ThrottlingException" || error.name === "TooManyRequestsException") {
    return { reason: "rate_limited", status: knownStatus };
  }
  if (error.name === "ResourceNotFoundException") {
    return { reason: "not_found", status: knownStatus };
  }
  if (knownStatus !== null && knownStatus >= 400) return refusalFromStatus(knownStatus);
  // The SDK could not read a 2xx body: something answered that is not the documented API.
  const answered = (error as { $response?: { statusCode?: number } }).$response?.statusCode;
  if (typeof answered === "number" && answered >= 200 && answered < 300) {
    return { reason: "malformed_response", status: null };
  }
  return refusalFromThrown(error);
}

/** A Bedrock agent deleted between ListAgents and its own reads, which drops it from the listing. */
export function isAwsResourceGone(error: unknown): boolean {
  return error instanceof Error && error.name === "ResourceNotFoundException";
}
