/**
 * Runs a Scenario Connector agent's blocks (ADR-194): setup and teardown as the run's hooks, the
 * call once per turn. Keeps what setup returned and scrubs every value it hands on.
 * @see modules/scenario/specs/scenario-run-hooks.feature
 */

import type { AgentHooks } from "@langwatch/agent-contract";
import { generate } from "@langwatch/ksuid";
import type { ConnectorAgentData, RunParameterValues } from "@langwatch/scenario-contract";

import type { ConnectorBlockChannel } from "../channels/connector-block.channel.ts";
import {
  type ConnectorBlockKind,
  type ConnectorMessage,
  type ConnectorObject,
  type ConnectorRun,
  ConnectorBlockError,
  connectorBlockInput,
  connectorBlockOutputs,
  connectorBlockWorkflow,
  connectorCallReply,
  connectorCodeTimeoutMs,
  connectorIdempotencyKey,
  connectorSetupAnswer,
  connectorTeardownAnswer,
  scrubbedJson,
  scrubbedText,
} from "../rules/connector-block.rules.ts";
import type { ScenarioHookCaller } from "./scenario-run-hooks.service.ts";

type HookKind = Exclude<ConnectorBlockKind, "call">;

type ScenarioConnectorOptions = {
  config: ConnectorAgentData;
  channel: ConnectorBlockChannel;
  projectApiKey: string;
  parameters?: RunParameterValues;
  run?: ConnectorRun;
  /** Fixed in a test; a fresh id per run otherwise. */
  attemptId?: string;
};

/** One run of a connector agent, holding the state and run-scoped secrets setup returned. */
export class ScenarioConnectorService implements ScenarioHookCaller {
  static create(options: ScenarioConnectorOptions): ScenarioConnectorService {
    return new ScenarioConnectorService(options);
  }

  private readonly config: ConnectorAgentData;
  private readonly channel: ConnectorBlockChannel;
  private readonly projectApiKey: string;
  private readonly parameters: RunParameterValues;
  private readonly run: ConnectorRun;
  private readonly attemptId: string;
  private state: ConnectorObject | null = null;
  private turnCount = 0;
  private secrets: Record<string, string> = {};

  private constructor(options: ScenarioConnectorOptions) {
    this.config = options.config;
    this.channel = options.channel;
    this.projectApiKey = options.projectApiKey;
    this.parameters = options.parameters ?? {};
    this.run = options.run ?? {};
    this.attemptId = options.attemptId ?? generate("hookattempt").toString();
  }

  /**
   * The hooks the run calls: a block's own, and setup whenever the connector is refused, so the
   * refusal is recorded and the run is not scored.
   */
  get declared(): AgentHooks {
    const { setup, teardown, refusal } = this.config;
    return { setup: Boolean(setup) || refusal !== undefined, teardown: Boolean(teardown) };
  }

  /** What setup returned as the run's state, which turns, the simulated user and the judge see. */
  get runState(): ConnectorObject | null {
    return this.state;
  }

  /**
   * Runs setup or teardown in the code runner. Setup's state and secrets are kept for the calls
   * and teardown; teardown's object is returned to be shown. Every value is scrubbed of secrets.
   * @throws ConnectorBlockError when the block fails, times out or answers out of shape.
   */
  async callHook({
    kind,
    timeoutMs,
  }: {
    kind: HookKind;
    timeoutMs: number;
  }): Promise<{ state?: ConnectorObject }> {
    return this.scrubbingFailures(async () => {
      const block = this.config[kind];
      if (!block) throw this.refusal();
      const outputs = await this.runBlock({ kind, block, timeoutMs });
      if (kind === "teardown") {
        const answer = connectorTeardownAnswer(outputs);
        return answer.state ? { state: this.scrubbed(answer.state) } : {};
      }
      const answer = connectorSetupAnswer(outputs);
      this.secrets = answer.secrets ?? {};
      this.state = answer.state ? this.scrubbed(answer.state) : null;
      return this.state ? { state: this.state } : {};
    });
  }

  /**
   * Runs the call block for one turn and answers its reply, scrubbed of secrets.
   * @throws ConnectorBlockError when the block fails, times out or returns no reply.
   */
  async callTurn(turn: { message: string; history: ConnectorMessage[] }): Promise<string> {
    return this.scrubbingFailures(async () => {
      const outputs = await this.runBlock({
        kind: "call",
        block: this.config.call,
        timeoutMs: this.config.timeoutMs,
        turn,
        turnIndex: this.turnCount++,
      });
      return this.scrub(connectorCallReply(outputs));
    });
  }

  /** A refused connector, or a hook without a block, fails before the code runner is called. */
  private refusal(): ConnectorBlockError {
    return new ConnectorBlockError({
      message: this.config.refusal ?? "The connector has no block for this step.",
    });
  }

  private async runBlock({
    kind,
    block,
    timeoutMs,
    turn,
    turnIndex,
  }: {
    kind: ConnectorBlockKind;
    block: ConnectorAgentData["call"];
    timeoutMs: number;
    turn?: { message: string; history: ConnectorMessage[] };
    turnIndex?: number;
  }): Promise<ConnectorObject> {
    if (this.config.refusal !== undefined) throw this.refusal();
    const input = connectorBlockInput({
      kind,
      run: this.run,
      idempotencyKey: connectorIdempotencyKey({
        run: this.run,
        attemptId: this.attemptId,
        kind,
        turn: turnIndex,
      }),
      params: this.parameters,
      rows: this.config.rows,
      state: this.state,
      ...(turn ? { turn } : {}),
    });
    const workflow = connectorBlockWorkflow({
      workflowId: `scenario-connector-${this.config.agentId}-${kind}`,
      block,
      input,
      params: this.parameters,
      // A run-scoped secret overrides a project secret of the same name, for this run only.
      secrets: kind === "setup" ? this.config.secrets : { ...this.config.secrets, ...this.secrets },
      projectApiKey: this.projectApiKey,
      codeTimeoutMs: connectorCodeTimeoutMs(timeoutMs),
    });
    const rawBody = await this.channel.post({ kind, workflow, input, timeoutMs });
    return connectorBlockOutputs({ kind, rawBody });
  }

  private async scrubbingFailures<T>(run: () => Promise<T>): Promise<T> {
    try {
      return await run();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const isTimeout = error instanceof ConnectorBlockError && error.code === "agent_call_timeout";
      throw new ConnectorBlockError({ message: this.scrub(message), isTimeout });
    }
  }

  /** Every secret value this run holds: the named ones, setup's own, and the run key. */
  private get knownSecretValues(): string[] {
    return [
      ...Object.values(this.config.secrets),
      ...Object.values(this.secrets),
      this.projectApiKey,
    ];
  }

  private scrub(text: string): string {
    return scrubbedText({ text, values: this.knownSecretValues });
  }

  private scrubbed(value: ConnectorObject): ConnectorObject {
    return scrubbedJson({ value, values: this.knownSecretValues });
  }
}
