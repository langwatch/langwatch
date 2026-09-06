import type {
  AgentTestRunResult,
  AgentTestTurnResult,
  AgentWithFields,
} from "@langwatch/agent-contract";

/** Who started a test, for the ownership check a connected agent is held to. */
export type AgentTestActor = { id: string; label: "user" };

/**
 * Sends one turn, or schedules one scripted run, against an agent through the
 * Scenario feature's execution pipeline — the same path a simulation takes.
 *
 * A port of its own rather than a method on {@link AgentsWorkflowPort} or a
 * sibling: testing an agent reaches the adapter registry, the prefetch and
 * the run queue the Scenario feature owns, none of which this package may
 * import (strict feature layout). A deployment that composes none of it
 * throws a plain `Error` at the call — nothing the caller sent causes the
 * gap, so it is not a `HandledError` (ADR-045).
 */
export abstract class AgentTestPort {
  abstract sendTurn(input: {
    projectId: string;
    agent: AgentWithFields;
    message: string;
    params?: Record<string, string | number | boolean>;
    actor: AgentTestActor | undefined;
  }): Promise<AgentTestTurnResult>;

  abstract scheduleRun(input: {
    projectId: string;
    agent: AgentWithFields;
    actor: AgentTestActor | undefined;
  }): Promise<AgentTestRunResult>;
}
