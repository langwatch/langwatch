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
  secretScrubberOf,
  type SecretScrubber,
} from "../rules/connector-block.rules.ts";
import {
  capErrorDetail,
  redactInternalAddresses,
  stripErrorNoise,
} from "../rules/execution-error.rules.ts";
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
  /** Every secret value setup returned, kept or refused, so none is shown. */
  private setupSecretValues: string[] = [];
  private scrubber: SecretScrubber | null = null;

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
      if (!block) throw this.refusal(kind);
      const outputs = await this.runBlock({ kind, block, timeoutMs });
      if (kind === "teardown") {
        const answer = connectorTeardownAnswer(outputs);
        return answer.state ? { state: this.scrubbed(answer.state) } : {};
      }
      const answer = connectorSetupAnswer({
        outputs,
        projectSecretNames: Object.keys(this.config.secrets),
      });
      // Kept before the answer is judged, so a failed setup's data can still be torn down.
      this.setupSecretValues = answer.secretValues;
      this.scrubber = null;
      this.secrets = answer.secrets;
      this.state = answer.state ? this.scrubbed(answer.state) : null;
      if (answer.problem) throw new ConnectorBlockError({ message: answer.problem });
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
      // Scrubbed as JSON first: a stringified object reply holds each secret JSON-escaped.
      return this.scrub(connectorCallReply(this.scrubbed(outputs)));
    });
  }

  /**
   * A refused connector, or a hook without a block, fails before the code runner is called. Only
   * setup records a refusal as failed; a refused teardown never ran, so it records not run.
   */
  private refusal(kind: ConnectorBlockKind): ConnectorBlockError {
    const { refusal } = this.config;
    if (refusal !== undefined && kind === "teardown") {
      return new ConnectorBlockError({
        message: "The connector was refused before any block ran, so teardown did not run.",
        code: "hook_refused",
      });
    }
    return new ConnectorBlockError({
      message: refusal ?? "The connector has no block for this step.",
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
    if (this.config.refusal !== undefined) throw this.refusal(kind);
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
      // Setup's own secrets never share a project secret's name (connectorSetupAnswer).
      secrets: kind === "setup" ? this.config.secrets : { ...this.config.secrets, ...this.secrets },
      projectApiKey: this.projectApiKey,
      codeTimeoutMs: connectorCodeTimeoutMs(timeoutMs),
    });
    const rawBody = await this.channel.post({ kind, workflow, input, timeoutMs });
    return connectorBlockOutputs({ kind, rawBody });
  }

  /** Errors reach here uncut: a cut before the scrub could leave a secret's first characters. */
  private async scrubbingFailures<T>(run: () => Promise<T>): Promise<T> {
    try {
      return await run();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const code = error instanceof ConnectorBlockError ? error.code : "hook_failed";
      // Secrets go first: noise stripping and address redaction alter text a secret could match.
      const shown = redactInternalAddresses(stripErrorNoise(this.scrub(message)));
      throw new ConnectorBlockError({ message: capErrorDetail(shown), code });
    }
  }

  /** Every secret value this run has seen: the named ones, all setup returned, the run key. */
  private get knownSecretValues(): string[] {
    return [...Object.values(this.config.secrets), ...this.setupSecretValues, this.projectApiKey];
  }

  /** Built once per set of known secrets, so each string scrubbed does not redo the variants. */
  private get activeScrubber(): SecretScrubber {
    this.scrubber ??= secretScrubberOf(this.knownSecretValues);
    return this.scrubber;
  }

  private scrub(text: string): string {
    return this.activeScrubber.text(text);
  }

  private scrubbed(value: ConnectorObject): ConnectorObject {
    return this.activeScrubber.json(value);
  }
}
