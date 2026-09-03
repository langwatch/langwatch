import {
  agentCopySchema,
  agentHistoryEntrySchema,
  agentSchema,
  agentWithFieldsSchema,
  relatedAgentEntitiesSchema,
  type Agent,
  type AgentCopy,
  type AgentHistoryEntry,
  type AgentWithFields,
  type CreateAgentCommand,
  type RelatedAgentEntities,
  type UpdateAgentCommand,
} from "@langwatch/agent-contract";
import {
  AgentBrowserPort,
  type AgentCopiesInput,
  type AgentCopyInput,
  type AgentCopyResult,
  type AgentHistoryInput,
  type AgentPushToCopiesInput,
  type AgentSyncFromSourceInput,
} from "@langwatch/agent-web/surfaces/browser-port";
import { z } from "zod";
import type { UiRpcPort } from "../../../behavior/ui-rpc";

type AgentArchiveInput = {
  id: string;
  projectId: string;
};

const agentCascadeArchiveSchema = z.object({
  agent: agentSchema,
  archivedWorkflow: z.object({ id: z.string() }).nullable(),
});
const agentCopyResultSchema = z.object({
  id: z.string(),
  projectId: z.string(),
  name: z.string(),
  copiedFromAgentId: z.string(),
});
const agentPushResultSchema = z.object({
  pushedTo: z.number(),
  selectedCopies: z.number(),
});
const agentSyncResultSchema = z.object({ ok: z.literal(true) });

type AgentCascadeArchive = z.infer<typeof agentCascadeArchiveSchema>;

export class TrpcAgentBrowserAdapter extends AgentBrowserPort {
  static create(rpc: UiRpcPort): TrpcAgentBrowserAdapter {
    return new TrpcAgentBrowserAdapter(rpc);
  }

  private constructor(private readonly rpc: UiRpcPort) {
    super();
  }

  async getById(input: { id: string; projectId: string }): Promise<AgentWithFields> {
    const output = await this.rpc.query("agents.getById", input);
    return agentWithFieldsSchema.parse(output);
  }

  async create(input: CreateAgentCommand): Promise<AgentWithFields> {
    const output = await this.rpc.mutate("agents.create", input);
    return agentWithFieldsSchema.parse(output);
  }

  async update(input: UpdateAgentCommand): Promise<AgentWithFields> {
    const output = await this.rpc.mutate("agents.update", input);
    return agentWithFieldsSchema.parse(output);
  }

  async relatedEntities(input: { id: string; projectId: string }): Promise<RelatedAgentEntities> {
    const output = await this.rpc.query("agents.getRelatedEntities", input);
    return relatedAgentEntitiesSchema.parse(output);
  }

  async cascadeArchive(input: AgentArchiveInput): Promise<AgentCascadeArchive> {
    const output = await this.rpc.mutate("agents.cascadeArchive", input);
    return agentCascadeArchiveSchema.parse(output);
  }

  async archive(input: AgentArchiveInput): Promise<Agent> {
    const output = await this.rpc.mutate("agents.delete", input);
    return agentSchema.parse(output);
  }

  async getCopies(input: AgentCopiesInput): Promise<AgentCopy[]> {
    const output = await this.rpc.query("agents.getCopies", input);
    return agentCopySchema.array().parse(output);
  }

  async copy(input: AgentCopyInput): Promise<AgentCopyResult> {
    const output = await this.rpc.mutate("agents.copy", input);
    return agentCopyResultSchema.parse(output);
  }

  async pushToCopies(input: AgentPushToCopiesInput): Promise<{
    pushedTo: number;
    selectedCopies: number;
  }> {
    const output = await this.rpc.mutate("agents.pushToCopies", input);
    return agentPushResultSchema.parse(output);
  }

  async syncFromSource(input: AgentSyncFromSourceInput): Promise<{ ok: true }> {
    const output = await this.rpc.mutate("agents.syncFromSource", input);
    return agentSyncResultSchema.parse(output);
  }

  async getHistory(input: AgentHistoryInput): Promise<AgentHistoryEntry[]> {
    const output = await this.rpc.query("agents.getHistory", input);
    return agentHistoryEntrySchema.array().parse(output);
  }
}
