import {
  agentCopySchema,
  agentCascadeArchiveSchema,
  agentCopyCreatedSchema,
  agentPushToCopiesSchema,
  agentSyncFromSourceSchema,
  type AgentApiAgentInput,
  agentHistoryEntrySchema,
  agentSchema,
  agentWithFieldsSchema,
  relatedAgentEntitiesSchema,
  type CreateAgentCommand,
  type UpdateAgentCommand,
} from "@langwatch/agent-contract";
import {
  type AgentClient,
  type AgentCopiesInput,
  type AgentCopyInput,
  type AgentHistoryInput,
  type AgentPushToCopiesInput,
  type AgentSyncFromSourceInput,
} from "@langwatch/agent-web/agent-client";
import type { UiRpc } from "../../../behavior/ui-rpc";

export class TrpcAgentClient implements AgentClient {
  static create(rpc: UiRpc): TrpcAgentClient {
    return new TrpcAgentClient(rpc);
  }

  private constructor(private readonly rpc: UiRpc) {}

  async getById(input: AgentApiAgentInput) {
    const output = await this.rpc.query("agents.getById", input);
    return agentWithFieldsSchema.parse(output);
  }

  async create(input: CreateAgentCommand) {
    const output = await this.rpc.mutate("agents.create", input);
    return agentWithFieldsSchema.parse(output);
  }

  async update(input: UpdateAgentCommand) {
    const output = await this.rpc.mutate("agents.update", input);
    return agentWithFieldsSchema.parse(output);
  }

  async relatedEntities(input: AgentApiAgentInput) {
    const output = await this.rpc.query("agents.getRelatedEntities", input);
    return relatedAgentEntitiesSchema.parse(output);
  }

  async cascadeArchive(input: AgentApiAgentInput) {
    const output = await this.rpc.mutate("agents.cascadeArchive", input);
    return agentCascadeArchiveSchema.parse(output);
  }

  async archive(input: AgentApiAgentInput) {
    const output = await this.rpc.mutate("agents.delete", input);
    return agentSchema.parse(output);
  }

  async getCopies(input: AgentCopiesInput) {
    const output = await this.rpc.query("agents.getCopies", input);
    return agentCopySchema.array().parse(output);
  }

  async copy(input: AgentCopyInput) {
    const output = await this.rpc.mutate("agents.copy", input);
    return agentCopyCreatedSchema.parse(output);
  }

  async pushToCopies(input: AgentPushToCopiesInput) {
    const output = await this.rpc.mutate("agents.pushToCopies", input);
    return agentPushToCopiesSchema.parse(output);
  }

  async syncFromSource(input: AgentSyncFromSourceInput) {
    const output = await this.rpc.mutate("agents.syncFromSource", input);
    return agentSyncFromSourceSchema.parse(output);
  }

  async getHistory(input: AgentHistoryInput) {
    const output = await this.rpc.query("agents.getHistory", input);
    return agentHistoryEntrySchema.array().parse(output);
  }
}
