import type { AgentService } from "@langwatch/agent-contract";

export {
  agentTypeSchema,
  createAgentCommandSchema,
  updateAgentCommandSchema,
} from "@langwatch/agent-contract";

export class AgentsRpcApi {
  static create(service: AgentService): AgentsRpcApi {
    return new AgentsRpcApi(service);
  }

  private constructor(private readonly service: AgentService) {}

  getAll(input: { projectId: string }) {
    return this.service.getAll(input);
  }

  getById(input: { id: string; projectId: string }) {
    return this.service.getById(input);
  }

  create(input: Parameters<AgentService["create"]>[0]) {
    return this.service.create(input);
  }

  update(input: Parameters<AgentService["update"]>[0]) {
    return this.service.update(input);
  }

  relatedEntities(input: { id: string; projectId: string }) {
    return this.service.relatedEntities(input);
  }

  cascadeArchive(input: { id: string; projectId: string }) {
    return this.service.cascadeArchive(input);
  }

  archive(input: { id: string; projectId: string }) {
    return this.service.archive(input);
  }

  getCopies(input: Parameters<AgentService["getCopies"]>[0]) {
    return this.service.getCopies(input);
  }

  getSourceOfCopy(input: Parameters<AgentService["getSourceOfCopy"]>[0]) {
    return this.service.getSourceOfCopy(input);
  }

  copy(input: Parameters<AgentService["copy"]>[0]) {
    return this.service.copy(input);
  }

  pushToCopies(input: Parameters<AgentService["pushToCopies"]>[0]) {
    return this.service.pushToCopies(input);
  }

  syncFromSource(input: Parameters<AgentService["syncFromSource"]>[0]) {
    return this.service.syncFromSource(input);
  }

  getHistory(input: Parameters<AgentService["getHistory"]>[0]) {
    return this.service.getHistory(input);
  }
}
