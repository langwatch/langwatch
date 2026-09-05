import type { CallOutcome, DispatchAgent, DispatchCall } from "@langwatch/agent-contract";

/**
 * Dispatches one turn to a connected agent, through the runtime a live SDK
 * process registered its instances on (ADR-128).
 *
 * A port rather than a direct `@langwatch/agent-server` import: a feature
 * server package may not import another feature's server package (strict
 * feature layout). This root is composed in `apps/api`, from
 * `getConnectedAgentRuntime().dispatcher`.
 */
export abstract class ExperimentConnectedDispatchPort {
  abstract dispatch(input: {
    projectId: string;
    agent: DispatchAgent;
    call: DispatchCall;
    signal: AbortSignal;
  }): Promise<CallOutcome>;
}
