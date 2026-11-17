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
import { KillSwitchPlatformError } from "../kill-switch-platform.channel.ts";

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

  async getInvocationState({
    signal,
    ...target
  }: BedrockAliasTarget & { signal?: AbortSignal }): Promise<BedrockInvocationState> {
    const client = this.clientFor(target);
    try {
      return (await this.readAlias({ client, target, signal })).aliasInvocationState;
    } finally {
      client.destroy();
    }
  }

  /**
   * The read sits right before the update to keep the window small: UpdateAgentAlias has no
   * conditional write, so a deployment between the two is overwritten (docs/governance/kill-switch.mdx).
   */
  async setInvocationState({
    state,
    signal,
    ...target
  }: BedrockAliasTarget & {
    state: BedrockInvocationState;
    signal?: AbortSignal;
  }): Promise<{ changed: boolean }> {
    const client = this.clientFor(target);
    try {
      const alias = await this.readAlias({ client, target, signal });
      if (alias.aliasInvocationState === state) return { changed: false };
      await client.send(
        new UpdateAgentAliasCommand({
          agentId: target.agentId,
          agentAliasId: target.agentAliasId,
          agentAliasName: alias.agentAliasName,
          description: alias.description,
          routingConfiguration: alias.routingConfiguration,
          aliasInvocationState: state,
        }),
        { abortSignal: signal },
      );
      return { changed: true };
    } finally {
      client.destroy();
    }
  }

  private async readAlias({
    client,
    target,
    signal,
  }: {
    client: BedrockAgentClient;
    target: BedrockAliasTarget;
    signal: AbortSignal | undefined;
  }) {
    const { agentId, agentAliasId } = target;
    const { agentAlias } = await client.send(new GetAgentAliasCommand({ agentId, agentAliasId }), {
      abortSignal: signal,
    });
    if (!agentAlias?.agentAliasName) {
      throw new KillSwitchPlatformError({
        code: "bedrock_alias_unreadable",
        message: `Bedrock answered no alias name for ${agentId}/${agentAliasId}`,
      });
    }
    return {
      agentAliasName: agentAlias.agentAliasName,
      description: agentAlias.description,
      routingConfiguration: agentAlias.routingConfiguration,
      aliasInvocationState: (agentAlias.aliasInvocationState ??
        "ACCEPT_INVOCATIONS") as BedrockInvocationState,
    };
  }

  private clientFor({ credentials, region }: BedrockAliasTarget): BedrockAgentClient {
    // With neither a key pair nor a role, the SDK would sign as the deployment itself.
    const hasKeyPair = Boolean(credentials.accessKeyId && credentials.secretAccessKey);
    if (!hasKeyPair && !credentials.roleArn) {
      throw new KillSwitchPlatformError({
        code: "aws_connection_incomplete",
        message: "The AWS connection holds neither an access key pair nor a role to assume",
      });
    }
    return new BedrockAgentClient(
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
  }
}
