// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import {
  BedrockAgentClient,
  GetAgentAliasCommand,
  UpdateAgentAliasCommand,
} from "@aws-sdk/client-bedrock-agent";
import { AwsClientConfiguration } from "@langwatch/aws-client";

import type { BedrockInvocationState } from "../../features/kill-switch/rules/agent-stop-target.rules.ts";
import type {
  BedrockAgentAliasChannel,
  BedrockAliasTarget,
} from "../bedrock-agent-alias.channel.ts";
import { KillSwitchPlatformError } from "../databricks-serving-endpoint.channel.ts";

/**
 * The Bedrock Agents control plane, signed with the organisation's AWS connection: a static key
 * pair, a role assumed with its external id, or both. `endpoint` replaces AWS's own for dogfood.
 */
export class HttpBedrockAgentAliasChannel implements BedrockAgentAliasChannel {
  // Bedrock is reached directly, never through the platform's outbound proxy, as S3 pulls are.
  readonly #aws = AwsClientConfiguration.create({
    outboundProxy: { tryResolveForHost: () => undefined },
  });

  private constructor(private readonly endpoint: string | undefined) {}

  static create({
    endpoint,
  }: { endpoint?: string | undefined } = {}): HttpBedrockAgentAliasChannel {
    return new HttpBedrockAgentAliasChannel(endpoint);
  }

  async setInvocationState({
    credentials,
    region,
    agentId,
    agentAliasId,
    state,
    signal,
  }: BedrockAliasTarget & {
    state: BedrockInvocationState;
    signal?: AbortSignal;
  }): Promise<{ changed: boolean }> {
    // With neither a key pair nor a role, the SDK would sign as the deployment itself.
    const hasKeyPair = Boolean(credentials.accessKeyId && credentials.secretAccessKey);
    if (!hasKeyPair && !credentials.roleArn) {
      throw new KillSwitchPlatformError({
        code: "aws_connection_incomplete",
        message: "The AWS connection holds neither an access key pair nor a role to assume",
      });
    }
    const client = new BedrockAgentClient(
      this.#aws.build({
        region,
        endpoint: this.endpoint,
        targetHost: this.endpoint
          ? new URL(this.endpoint).host
          : `bedrock-agent.${region}.amazonaws.com`,
        staticCredentials: {
          accessKeyId: credentials.accessKeyId,
          secretAccessKey: credentials.secretAccessKey,
        },
        assumeRole: credentials.roleArn
          ? {
              roleArn: credentials.roleArn,
              externalId: credentials.externalId,
              sessionName: "langwatch-kill-switch",
            }
          : null,
      }),
    );
    try {
      const { agentAlias } = await client.send(
        new GetAgentAliasCommand({ agentId, agentAliasId }),
        {
          abortSignal: signal,
        },
      );
      if (!agentAlias?.agentAliasName) {
        throw new KillSwitchPlatformError({
          code: "bedrock_alias_unreadable",
          message: `Bedrock answered no alias name for ${agentId}/${agentAliasId}`,
        });
      }
      if (agentAlias.aliasInvocationState === state) return { changed: false };
      await client.send(
        new UpdateAgentAliasCommand({
          agentId,
          agentAliasId,
          agentAliasName: agentAlias.agentAliasName,
          description: agentAlias.description,
          routingConfiguration: agentAlias.routingConfiguration,
          aliasInvocationState: state,
        }),
        { abortSignal: signal },
      );
      return { changed: true };
    } finally {
      client.destroy();
    }
  }
}
