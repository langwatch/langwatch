// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import type { BedrockInvocationState } from "../../features/kill-switch/rules/agent-stop-target.rules.ts";
import type {
  BedrockAgentAliasChannel,
  BedrockAliasTarget,
} from "../bedrock-agent-alias.channel.ts";
import { KillSwitchPlatformError } from "../kill-switch-platform.channel.ts";

/** One alias as the memory control plane holds it. */
type MemoryBedrockAlias = {
  agentAliasName: string;
  description: string | undefined;
  routingConfiguration: { agentVersion: string }[];
  aliasInvocationState: BedrockInvocationState;
};

type MemoryBedrockUpdate = {
  region: string;
  agentId: string;
  agentAliasId: string;
  agentAliasName: string;
  description: string | undefined;
  routingConfiguration: { agentVersion: string }[];
  aliasInvocationState: BedrockInvocationState;
};

/**
 * The Bedrock control plane in memory: it reads and updates the aliases a test seeded, records
 * every update, and throws the error name a test seeded, as the SDK does.
 */
export class MemoryBedrockAgentAliasChannel implements BedrockAgentAliasChannel {
  readonly reads: { agentId: string; agentAliasId: string }[] = [];
  readonly updates: MemoryBedrockUpdate[] = [];
  private readonly aliases = new Map<string, MemoryBedrockAlias>();
  private refusal: string | null = null;

  private constructor() {}

  static create(): MemoryBedrockAgentAliasChannel {
    return new MemoryBedrockAgentAliasChannel();
  }

  seed({
    agentId,
    agentAliasId,
    alias,
  }: {
    agentId: string;
    agentAliasId: string;
    alias: MemoryBedrockAlias;
  }): void {
    this.aliases.set(`${agentId}/${agentAliasId}`, structuredClone(alias));
  }

  /** Every call throws an error named `name` until cleared with null. */
  refuseWith(name: string | null): void {
    this.refusal = name;
  }

  /** The alias as stored now, for a test that asserts on its state; throws when never seeded. */
  getAlias({
    agentId,
    agentAliasId,
  }: {
    agentId: string;
    agentAliasId: string;
  }): MemoryBedrockAlias {
    const alias = this.aliases.get(`${agentId}/${agentAliasId}`);
    if (!alias) throw new Error(`no alias ${agentId}/${agentAliasId} was seeded`);
    return structuredClone(alias);
  }

  async getInvocationState({
    agentId,
    agentAliasId,
  }: BedrockAliasTarget): Promise<BedrockInvocationState> {
    return this.read({ agentId, agentAliasId }).aliasInvocationState;
  }

  async setInvocationState({
    region,
    agentId,
    agentAliasId,
    state,
  }: BedrockAliasTarget & { state: BedrockInvocationState }): Promise<{ changed: boolean }> {
    const alias = this.read({ agentId, agentAliasId });
    if (alias.aliasInvocationState === state) return { changed: false };
    alias.aliasInvocationState = state;
    this.updates.push({
      region,
      agentId,
      agentAliasId,
      agentAliasName: alias.agentAliasName,
      description: alias.description,
      routingConfiguration: structuredClone(alias.routingConfiguration),
      aliasInvocationState: state,
    });
    return { changed: true };
  }

  private read({ agentId, agentAliasId }: { agentId: string; agentAliasId: string }) {
    if (this.refusal) {
      const error = new Error(`seeded ${this.refusal}`);
      error.name = this.refusal;
      throw error;
    }
    this.reads.push({ agentId, agentAliasId });
    const alias = this.aliases.get(`${agentId}/${agentAliasId}`);
    if (!alias) {
      throw new KillSwitchPlatformError({
        code: "ResourceNotFoundException",
        message: `no alias ${agentId}/${agentAliasId}`,
      });
    }
    return alias;
  }
}
