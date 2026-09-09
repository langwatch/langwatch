import type { CallOutcome, DispatchAgent, DispatchCall } from "@langwatch/agent-contract";

/**
 * Dispatches one turn to a connected agent, through the runtime a live SDK
 * process registered its instances on (ADR-128).
 */
export abstract class ExperimentConnectedDispatchPort {
  abstract dispatch(input: {
    projectId: string;
    agent: DispatchAgent;
    call: DispatchCall;
    signal: AbortSignal;
  }): Promise<CallOutcome>;
}
