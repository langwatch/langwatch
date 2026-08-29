/**
 * The agent feature's application: what all of its doors call.
 *
 * It holds every service the feature needs, and it is the one typed thing a
 * transport is given. Before it, the tRPC door declared its own
 * `Readonly<{ agents: AgentService }>` while the deprecated `/api/agents` Hono
 * family reached a second facade over the same service — two descriptions of
 * one bag, agreeing by attention rather than by construction.
 *
 * Most operations are the service's own, reached through {@link agents}. What
 * lives here as a rule is what a door would otherwise have to know: today that
 * is the platform's agent-id scheme, which the tRPC door and the REST family
 * each spelled out for themselves.
 *
 * A caller arrives as an argument, never read from a session or a request, so
 * one operation serves a browser session, an API key and a background job
 * without knowing which it is serving.
 */
import type { AgentService } from "@langwatch/agent-contract";
import { nanoid } from "nanoid";

/** What the process composes this feature's application from. */
export interface AgentAppDependencies {
  agents: AgentService;
}

export class AgentApp {
  static create(dependencies: AgentAppDependencies): AgentApp {
    return new AgentApp(dependencies);
  }

  private constructor(private readonly dependencies: AgentAppDependencies) {}

  /**
   * The platform's agent-id scheme.
   *
   * Static because the two doors mint at different moments — the tRPC door
   * hands the generator to its input schema, which is built once at module
   * load, while the REST family mints inside the request — and neither moment
   * should be a second copy of what an agent id looks like. It was two copies
   * before this: `agent_${nanoid()}` in `api/app-trpc/agent.api.ts` and again
   * in `api/app-rest/agent-legacy.api.ts`.
   */
  static nextAgentId(): string {
    return `agent_${nanoid()}`;
  }

  /** Every non-archived agent in one project. */
  getAll(input: Parameters<AgentService["getAll"]>[0]) {
    return this.dependencies.agents.getAll(input);
  }

  /** One agent, by id, inside one project. */
  getById(input: Parameters<AgentService["getById"]>[0]) {
    return this.dependencies.agents.getById(input);
  }

  /** One page of the project's non-archived agents. */
  list(input: Parameters<AgentService["list"]>[0]) {
    return this.dependencies.agents.list(input);
  }

  /** Stores a new agent. The id is the caller's, or {@link nextAgentId}'s. */
  create(input: Parameters<AgentService["create"]>[0]) {
    return this.dependencies.agents.create(input);
  }

  /** Replaces an agent's stored configuration. */
  update(input: Parameters<AgentService["update"]>[0]) {
    return this.dependencies.agents.update(input);
  }

  /** Soft-deletes one agent. */
  archive(input: Parameters<AgentService["archive"]>[0]) {
    return this.dependencies.agents.archive(input);
  }

  /** What else in the project points at this agent. */
  relatedEntities(input: Parameters<AgentService["relatedEntities"]>[0]) {
    return this.dependencies.agents.relatedEntities(input);
  }

  /** Archives the agent and whatever the archive must take with it. */
  cascadeArchive(input: Parameters<AgentService["cascadeArchive"]>[0]) {
    return this.dependencies.agents.cascadeArchive(input);
  }

  /** Every copy made from one source agent, across projects. */
  getCopies(input: Parameters<AgentService["getCopies"]>[0]) {
    return this.dependencies.agents.getCopies(input);
  }

  /** The agent one copy was made from. */
  getSourceOfCopy(input: Parameters<AgentService["getSourceOfCopy"]>[0]) {
    return this.dependencies.agents.getSourceOfCopy(input);
  }

  /** Copies one agent into another project. */
  copy(input: Parameters<AgentService["copy"]>[0]) {
    return this.dependencies.agents.copy(input);
  }

  /** Pushes a source agent's configuration onto the named copies. */
  pushToCopies(input: Parameters<AgentService["pushToCopies"]>[0]) {
    return this.dependencies.agents.pushToCopies(input);
  }

  /** Pulls the source agent's configuration back onto this copy. */
  syncFromSource(input: Parameters<AgentService["syncFromSource"]>[0]) {
    return this.dependencies.agents.syncFromSource(input);
  }

  /** One agent's edit history. */
  getHistory(input: Parameters<AgentService["getHistory"]>[0]) {
    return this.dependencies.agents.getHistory(input);
  }
}
