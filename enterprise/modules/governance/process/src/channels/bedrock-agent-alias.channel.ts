// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import type { BedrockInvocationState } from "../features/kill-switch/rules/agent-stop-target.rules.ts";
import type { GovernanceAwsCredentials } from "../repositories/governance-aws-connection.repository.ts";

/** Where one Bedrock call goes and what it signs with. */
export type BedrockAliasTarget = {
  credentials: GovernanceAwsCredentials;
  region: string;
  agentId: string;
  agentAliasId: string;
};

/**
 * A Bedrock agent alias's invocation state. Setting it reads the alias, then updates it with its
 * own name, description and routing at once, so nothing but the state changes; an alias already in
 * `state` is left alone (`changed: false`). Both throw with the SDK error's name.
 */
export interface BedrockAgentAliasChannel {
  getInvocationState(
    args: BedrockAliasTarget & { signal?: AbortSignal },
  ): Promise<BedrockInvocationState>;
  setInvocationState(
    args: BedrockAliasTarget & { state: BedrockInvocationState; signal?: AbortSignal },
  ): Promise<{ changed: boolean }>;
}
