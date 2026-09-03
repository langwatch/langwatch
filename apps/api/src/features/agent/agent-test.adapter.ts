/**
 * "Test agent", over the Scenario application this process already composes.
 *
 * A bridge in the PROCESS rather than in either package, the same shape
 * {@link ApiAgentWorkflowCopyAdapter} occupies for the workflow copy: `agent`
 * and `scenario` are both core features and neither may reach the other, so
 * the seam belongs to the composition root.
 *
 * The service arrives as a THUNK because of composition order, not taste.
 * `resolveAgents` runs before the agent-group half that builds
 * `AgentTestService`, so a service read at composition time would always be
 * absent. It is read at the call instead, which is the only moment it is
 * needed.
 */
import { AgentTestPort, type AgentTestActor } from "@langwatch/agent-server";
import type { AgentWithFields } from "@langwatch/agent-contract";
import type { AgentTestRunResult, AgentTestService, AgentTestTurnResult } from "@langwatch/scenario-server";

export class ApiAgentTestAdapter extends AgentTestPort {
  static create(options: {
    /** The Scenario application's test runner, resolved at the call. */
    service: () => AgentTestService | undefined;
    /** Names the process in the refusal, so a stack trace says whose gap this is. */
    processName: string;
  }): ApiAgentTestAdapter {
    return new ApiAgentTestAdapter(options.service, options.processName);
  }

  private constructor(
    private readonly service: () => AgentTestService | undefined,
    private readonly processName: string,
  ) {
    super();
  }

  private require(): AgentTestService {
    const service = this.service();
    if (!service) {
      // A plain `Error` on purpose (ADR-045): nothing the caller sent causes
      // it and nothing they can send avoids it — it is a fact about which
      // tier is serving them.
      throw new Error(
        `${this.processName} composed no Scenario application, so "Test agent" cannot run.`,
      );
    }
    return service;
  }

  sendTurn(input: {
    projectId: string;
    agent: AgentWithFields;
    message: string;
    params?: Record<string, string | number | boolean>;
    actor: AgentTestActor | undefined;
  }): Promise<AgentTestTurnResult> {
    return this.require().sendTurn(input);
  }

  scheduleRun(input: {
    projectId: string;
    agent: AgentWithFields;
    actor: AgentTestActor | undefined;
  }): Promise<AgentTestRunResult> {
    return this.require().scheduleRun(input);
  }
}
