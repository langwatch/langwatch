/** One live connected agent instance that answered a turn. */
export type AgentTestConnectedInstance = { hostname: string; label: string | null };

/** What a dispatched connected turn answered. */
export type AgentTestConnectedDispatchResult = {
  output: unknown;
  durationMs: number;
  instance: AgentTestConnectedInstance;
};

/**
 * Dispatches one turn to a connected agent, through the runtime a live SDK
 * process registered its instances on — the same dispatcher a simulation's
 * connected column uses (ADR-128).
 *
 * A port rather than a direct `@langwatch/agent-server` import: a feature
 * server package may not import another feature's server package (strict
 * feature layout). This root is composed in `apps/api`, from
 * `getConnectedAgentRuntime().dispatcher`. With no instance registered it
 * answers `agent_offline` — the runtime holds no memory of anyone until the
 * connected-agents transport (`connect.gateway`, long-poll) is restored.
 */
export abstract class AgentTestConnectedDispatchPort {
  abstract dispatch(input: {
    projectId: string;
    agentId: string;
    agentName: string;
    environment: string | null;
    /** The agent's own stored config, opaque here — only the composed
     * adapter, which may import the Agent feature's types, reads it. */
    config: unknown;
    message: string;
    params?: Record<string, string | number | boolean>;
  }): Promise<AgentTestConnectedDispatchResult>;
}
