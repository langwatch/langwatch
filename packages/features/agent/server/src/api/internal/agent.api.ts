import type { AgentApp } from "#app/agent.app";

export {
  agentTypeSchema,
  createAgentCommandSchema,
  updateAgentCommandSchema,
} from "@langwatch/agent-contract";

/**
 * The internal RPC vocabulary over the feature's application.
 *
 * It reaches {@link AgentApp} rather than the service directly, so this door
 * and the two public ones answer from one object: an id scheme or a guard the
 * application grows is one this surface gets too, instead of a fourth place
 * that has to be remembered.
 */
export class AgentsRpcApi {
  static create(app: AgentApp): AgentsRpcApi {
    return new AgentsRpcApi(app);
  }

  private constructor(private readonly app: AgentApp) {}

  getAll(input: Parameters<AgentApp["getAll"]>[0]) {
    return this.app.getAll(input);
  }

  getById(input: Parameters<AgentApp["getById"]>[0]) {
    return this.app.getById(input);
  }

  create(input: Parameters<AgentApp["create"]>[0]) {
    return this.app.create(input);
  }

  update(input: Parameters<AgentApp["update"]>[0]) {
    return this.app.update(input);
  }

  relatedEntities(input: Parameters<AgentApp["relatedEntities"]>[0]) {
    return this.app.relatedEntities(input);
  }

  cascadeArchive(input: Parameters<AgentApp["cascadeArchive"]>[0]) {
    return this.app.cascadeArchive(input);
  }

  archive(input: Parameters<AgentApp["archive"]>[0]) {
    return this.app.archive(input);
  }

  getCopies(input: Parameters<AgentApp["getCopies"]>[0]) {
    return this.app.getCopies(input);
  }

  getSourceOfCopy(input: Parameters<AgentApp["getSourceOfCopy"]>[0]) {
    return this.app.getSourceOfCopy(input);
  }

  copy(input: Parameters<AgentApp["copy"]>[0]) {
    return this.app.copy(input);
  }

  pushToCopies(input: Parameters<AgentApp["pushToCopies"]>[0]) {
    return this.app.pushToCopies(input);
  }

  syncFromSource(input: Parameters<AgentApp["syncFromSource"]>[0]) {
    return this.app.syncFromSource(input);
  }

  getHistory(input: Parameters<AgentApp["getHistory"]>[0]) {
    return this.app.getHistory(input);
  }
}
