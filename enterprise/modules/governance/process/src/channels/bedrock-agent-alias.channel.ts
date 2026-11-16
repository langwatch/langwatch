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
 * Setting a Bedrock agent alias's invocation state: read the alias, then update it with its own
 * name, description and routing so nothing but the state changes. Throws with the SDK error's name.
 */
export interface BedrockAgentAliasChannel {
  setInvocationState(
    args: BedrockAliasTarget & { state: BedrockInvocationState; signal?: AbortSignal },
  ): Promise<void>;
}
