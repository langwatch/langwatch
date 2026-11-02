/**
 * Runs an HTTP agent's Connector steps (ADR-194) as its setup and teardown hooks: builds each
 * step's input and workflow, keeps what setup returned, and scrubs every value it hands on.
 * @see modules/scenario/specs/scenario-run-hooks.feature
 */

import type { AgentHooks } from "@langwatch/agent-contract";
import { generate } from "@langwatch/ksuid";
import type { ConnectorData, RunParameterValues } from "@langwatch/scenario-contract";

import type { ConnectorHookChannel } from "../channels/connector-hook.channel.ts";
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
  scrubbedJson,
} from "../rules/connector-step.rules.ts";
import type { ScenarioCallRun } from "../rules/scenario-call-run.rules.ts";
import * as ScenarioSecretReferenceAdapter from "../rules/scenario-secret-reference.rules.ts";
import type { ScenarioHookCaller } from "./scenario-run-hooks.service.ts";

type ScenarioConnectorHooksOptions = {
  agentId: string;
  connector: ConnectorData;
  channel: ConnectorHookChannel;
  projectApiKey: string;
  parameters?: RunParameterValues;
  run?: ScenarioCallRun;
  /** Fixed in a test; a fresh id per run otherwise. */
  attemptId?: string;
};

/** The Connector's steps as one run's setup and teardown, holding what setup returned. */
export class ScenarioConnectorHooksService implements ScenarioHookCaller {
  static create(options: ScenarioConnectorHooksOptions): ScenarioConnectorHooksService {
    return new ScenarioConnectorHooksService(options);
  }

  private readonly agentId: string;
  private readonly connector: ConnectorData;
  private readonly channel: ConnectorHookChannel;
  private readonly projectApiKey: string;
  private readonly parameters: RunParameterValues;
  private readonly run: ScenarioCallRun;
  private readonly attemptId: string;
  private state: ConnectorObject | null = null;
  private secrets: Record<string, string> = {};

  private constructor(options: ScenarioConnectorHooksOptions) {
    this.agentId = options.agentId;
    this.connector = options.connector;
    this.channel = options.channel;
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
    const rawBody = await this.channel.post({ kind, workflow, input, timeoutMs });
    return connectorStepAnswer({ kind, outputs: connectorStepOutputs({ kind, rawBody }) });
  }

  /** Every secret value this run holds: the steps' named ones, setup's own, and the run key. */
  private get knownSecretValues(): string[] {
    return [
      ...Object.values(this.connector.setup?.secrets ?? {}),
      ...Object.values(this.connector.teardown?.secrets ?? {}),
      ...Object.values(this.secrets),
      this.projectApiKey,
    ];
  }

  private scrub(message: string): string {
    return ScenarioSecretReferenceAdapter.redactValues({
      message,
      values: this.knownSecretValues,
    });
  }

  private scrubbed(value: ConnectorObject): ConnectorObject {
    return scrubbedJson({ value, values: this.knownSecretValues });
  }
}
