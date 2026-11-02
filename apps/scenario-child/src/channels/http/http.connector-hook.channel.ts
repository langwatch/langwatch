/**
 * Runs an HTTP agent's Connector steps (ADR-194) as its setup and teardown hooks. Each step's code
 * runs only in the code runner, posted over the execute_sync transport a code agent's turn uses;
 * this process never evaluates it.
 * @see modules/scenario/specs/scenario-run-hooks.feature
 */

import { randomBytes } from "crypto";

import type { AgentHooks } from "@langwatch/agent-contract";
import { generate } from "@langwatch/ksuid";
import type { ConnectorData, RunParameterValues } from "@langwatch/scenario-contract";

import {
  type ConnectorHookKind,
  type ConnectorObject,
  ConnectorStepError,
  connectorCodeTimeoutMs,
  connectorIdempotencyKey,
  connectorStepAnswer,
  connectorStepInput,
  connectorStepOutputs,
  connectorStepRefusal,
  connectorStepWorkflow,
  connectorTimeoutMessage,
  scrubbedJson,
} from "../../rules/connector-step.rules.ts";
import type { ScenarioCallRun } from "../../rules/scenario-call-run.rules.ts";
import * as ScenarioSecretReferenceAdapter from "../../rules/scenario-secret-reference.rules.ts";
import type { ScenarioHookCaller } from "../../services/scenario-run-hooks.service.ts";
import type { ExecuteSyncTransport } from "../execute-sync.channel.ts";

/** The Connector's steps as one run's setup and teardown, holding what setup returned. */
export class ConnectorHookCaller implements ScenarioHookCaller {
  static create(options: {
    agentId: string;
    connector: ConnectorData;
    transport: ExecuteSyncTransport;
    projectApiKey: string;
    parameters?: RunParameterValues;
    run?: ScenarioCallRun;
    /** Fixed in a test; a fresh id per run otherwise. */
    attemptId?: string;
  }): ConnectorHookCaller {
    return new ConnectorHookCaller(options);
  }

  private readonly agentId: string;
  private readonly connector: ConnectorData;
  private readonly transport: ExecuteSyncTransport;
  private readonly projectApiKey: string;
  private readonly parameters: RunParameterValues;
  private readonly run: ScenarioCallRun;
  private readonly attemptId: string;
  private state: ConnectorObject | null = null;
  private secrets: Record<string, string> = {};

  private constructor(options: {
    agentId: string;
    connector: ConnectorData;
    transport: ExecuteSyncTransport;
    projectApiKey: string;
    parameters?: RunParameterValues;
    run?: ScenarioCallRun;
    attemptId?: string;
  }) {
    this.agentId = options.agentId;
    this.connector = options.connector;
    this.transport = options.transport;
    this.projectApiKey = options.projectApiKey;
    this.parameters = options.parameters ?? {};
    this.run = options.run ?? {};
    this.attemptId = options.attemptId ?? generate("hookattempt").toString();
  }

  /** The hooks this Connector has a step for. */
  get declared(): AgentHooks {
    return { setup: Boolean(this.connector.setup), teardown: Boolean(this.connector.teardown) };
  }

  /** What setup returned as the run's state, which turns, the simulated user and the judge see. */
  get runState(): ConnectorObject | null {
    return this.state;
  }

  /** The run-scoped secrets setup returned; turn templates read them, nothing records them. */
  get runSecrets(): Record<string, string> {
    return this.secrets;
  }

  /**
   * Runs one step in the code runner. Setup's state and secrets are kept for the turns and
   * teardown; teardown's object is returned to be shown. Every value is scrubbed of secrets.
   * @throws ConnectorStepError when the step fails, times out or answers out of shape.
   */
  async callHook({
    kind,
    timeoutMs,
  }: {
    kind: ConnectorHookKind;
    timeoutMs: number;
  }): Promise<{ state?: ConnectorObject }> {
    try {
      const answer = await this.runStep({ kind, timeoutMs });
      if (kind === "setup") {
        this.secrets = answer.secrets ?? {};
        this.state = answer.state ? this.scrubbed(answer.state) : null;
        return this.state ? { state: this.state } : {};
      }
      return answer.state ? { state: this.scrubbed(answer.state) } : {};
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const isTimeout = error instanceof ConnectorStepError && error.code === "agent_call_timeout";
      throw new ConnectorStepError({ message: this.scrub(message), isTimeout });
    }
  }

  private async runStep({
    kind,
    timeoutMs,
  }: {
    kind: ConnectorHookKind;
    timeoutMs: number;
  }): Promise<{ state?: ConnectorObject; secrets?: Record<string, string> }> {
    const step = this.connector[kind];
    if (!step) throw new ConnectorStepError({ message: `The Connector has no ${kind} step.` });
    const refusal = connectorStepRefusal({ kind, step });
    if (refusal) throw new ConnectorStepError({ message: refusal });
    const idempotencyKey = connectorIdempotencyKey({
      run: this.run,
      attemptId: this.attemptId,
      kind,
    });
    const input = connectorStepInput({
      kind,
      run: this.run,
      idempotencyKey,
      params: this.parameters,
      rows: step.rows,
      state: this.state,
    });
    const workflow = connectorStepWorkflow({
      workflowId: `scenario-connector-${this.agentId}-${kind}`,
      step,
      input,
      params: this.parameters,
      // A run-scoped secret overrides a project secret of the same name, for this run only.
      secrets: kind === "teardown" ? { ...step.secrets, ...this.secrets } : step.secrets,
      projectApiKey: this.projectApiKey,
      codeTimeoutMs: connectorCodeTimeoutMs(timeoutMs),
    });
    const rawBody = await this.post({ kind, workflow, input, timeoutMs });
    return connectorStepAnswer({ kind, outputs: connectorStepOutputs({ kind, rawBody }) });
  }

  /** One execute_sync POST, aborted at the hook's budget; answers the body as text. */
  private async post({
    kind,
    workflow,
    input,
    timeoutMs,
  }: {
    kind: ConnectorHookKind;
    workflow: Record<string, unknown>;
    input: ConnectorObject;
    timeoutMs: number;
  }): Promise<string> {
    const event = {
      type: "execute_flow" as const,
      payload: {
        trace_id: randomBytes(16).toString("hex"),
        workflow,
        inputs: [{ input }],
        manual_execution_mode: false,
        do_not_trace: true,
        run_evaluations: false,
      },
    };
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await this.transport.post({
        event,
        signal: controller.signal,
        timeoutMs,
      });
      const rawBody = await response.text();
      if (!response.ok) {
        throw new ConnectorStepError({
          message: `The code runner answered the ${kind} step with HTTP ${response.status}: ${rawBody.slice(0, 500)}`,
        });
      }
      return rawBody;
    } catch (error) {
      if (error instanceof ConnectorStepError) throw error;
      if (controller.signal.aborted) {
        throw new ConnectorStepError({
          message: connectorTimeoutMessage({ kind, timeoutMs }),
          isTimeout: true,
        });
      }
      const code =
        typeof error === "object" && error !== null && "code" in error ? error.code : null;
      throw new ConnectorStepError({
        message: `The code runner could not be reached for the ${kind} step${typeof code === "string" ? ` (${code})` : ""}.`,
      });
    } finally {
      clearTimeout(timer);
    }
  }

  /** Every secret value this run holds: the steps' named ones, setup's own, and the run key. */
  private get knownSecrets(): Record<string, string> {
    // Listed by value, not merged by name: a run-scoped secret can shadow a project one.
    const values = [
      ...Object.values(this.connector.setup?.secrets ?? {}),
      ...Object.values(this.connector.teardown?.secrets ?? {}),
      ...Object.values(this.secrets),
      this.projectApiKey,
    ];
    return Object.fromEntries(values.map((value, index) => [String(index), value]));
  }

  private scrub(message: string): string {
    return ScenarioSecretReferenceAdapter.redact({ message, secrets: this.knownSecrets });
  }

  private scrubbed(value: ConnectorObject): ConnectorObject {
    return scrubbedJson({ value, secrets: this.knownSecrets });
  }
}
