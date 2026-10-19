/**
 * Serialized workflow agent adapter for scenario worker execution. Operates with pre-fetched
 * workflow DSL and doesn't require database access.
 */

import { randomBytes } from "crypto";

import { injectTraceContextHeaders } from "@langwatch/observability/tracing";
import type { AgentInput } from "@langwatch/scenario";
import { AgentRole } from "@langwatch/scenario";
import { resolveFieldMappings } from "@langwatch/scenario-contract";
import type { RunParameterValues, WorkflowAgentData } from "@langwatch/scenario-contract";

import { type ExecuteSyncResponse, type ExecuteSyncTransport } from "../execute-sync.channel.ts";
import { type NlpFetchTimeouts } from "../nlp-fetch.channel.ts";
import { SerializedAgentChannel } from "../serialized-agent.channel.ts";
import { directExecuteSyncTransport } from "./http.execute-sync.channel.ts";
import { HttpNlpFetchChannel } from "./http.nlp-fetch.channel.ts";

/**
 * How long to wait on the NLP service for one turn.
 */
function fetchTimeoutMs(timeouts: NlpFetchTimeouts): number {
  const transport = HttpNlpFetchChannel.create({ timeouts });

  return Math.min(transport.maxTimeoutMs(), transport.floorTimeoutMs());
}

/**
 * Serialized workflow agent adapter that uses pre-fetched workflow DSL.
 * Sends execute_flow events to the NLP service. No database access required.
 */
export class HttpSerializedWorkflowAgentChannel extends SerializedAgentChannel {
  static create(options: {
    config: WorkflowAgentData;
    nlpServiceUrl: string;
    projectApiKey: string;
    parameters?: RunParameterValues;
    timeouts?: NlpFetchTimeouts;
    /** The engine hop's shared credential, as the parent stated it for this child. */
    nlpInternalSecret?: string | undefined;
    /** How the turn reaches the project's engine; absent posts to `nlpServiceUrl` directly. */
    transport?: ExecuteSyncTransport;
  }): HttpSerializedWorkflowAgentChannel {
    return new HttpSerializedWorkflowAgentChannel(options);
  }

  role = AgentRole.AGENT;

  private readonly config: WorkflowAgentData;
  private readonly nlpServiceUrl: string;
  /**
   * The run's own LangWatch key (minted for this run), sent as workflow.api_key.
   * Never an LLM provider credential, so it must not be sourced from litellm
   * params (issue #6634).
   */
  private readonly projectApiKey: string;
  /**
   * The run's resolved parameter values.
   */
  private readonly parameters: RunParameterValues;
  /** The operator's deadlines, as the process that composed this read them. */
  private readonly timeouts: NlpFetchTimeouts;
  /** The engine hop's shared credential, as the parent stated it for this child. */
  private readonly nlpInternalSecret: string | undefined;
  /** How the turn reaches the project's engine. */
  private readonly transport: ExecuteSyncTransport;

  constructor({
    config,
    nlpServiceUrl,
    projectApiKey,
    parameters,
    timeouts,
    nlpInternalSecret,
    transport,
  }: {
    config: WorkflowAgentData;
    nlpServiceUrl: string;
    projectApiKey: string;
    parameters?: RunParameterValues;
    timeouts?: NlpFetchTimeouts;
    nlpInternalSecret?: string | undefined;
    transport?: ExecuteSyncTransport;
  }) {
    super();
    this.config = config;
    this.nlpServiceUrl = nlpServiceUrl;
    this.projectApiKey = projectApiKey;
    this.parameters = parameters ?? {};
    this.timeouts = timeouts ?? {};
    this.nlpInternalSecret = nlpInternalSecret;
    this.transport = transport ?? directExecuteSyncTransport({ nlpServiceUrl, nlpInternalSecret });
    this.name = "SerializedWorkflowAgentAdapter";
  }

  async call(input: AgentInput): Promise<string> {
    const inputRecord = this.resolveInputValues(input);
    const result = await this.executeOnNlpService(inputRecord);
    return this.extractOutput(result);
  }

  /**
   * Resolve input values from scenarioMappings (on the agent config) or fall back to legacy
   * behavior — identical to the code agent's resolver. With scenarioMappings: resolve each declared
   * agent input from its mapping.
   */
  private resolveInputValues(agentInput: AgentInput): Record<string, string> {
    // A declared input wins over a parameter of the same name. Spread the other
    // way round and a parameter called `input` would quietly replace the
    // conversation turn the target is supposed to answer, and the run would
    // read as an agent that ignored the user.
    return {
      ...this.parametersAsEntryInputs(),
      ...this.resolveMappedInputValues(agentInput),
    };
  }

  /**
   * The `params` namespace for one turn: the run's resolved values plus this turn's trace context,
   * so a code node inside the workflow can forward `params.trace_id` or `params.traceparent` to
   * whatever it calls. Captured per call, because every turn opens its own trace.
   */
  private turnParameters(): RunParameterValues {
    const { headers, traceId } = injectTraceContextHeaders({ headers: {} });
    const traceparent = headers.traceparent;
    return {
      ...this.parameters,
      ...(traceId !== undefined && { trace_id: traceId }),
      ...(traceparent !== undefined && { traceparent }),
    };
  }

  /**
   * The run's parameters as entry inputs. Entry inputs are strings on the
   * wire, so a number or a boolean is coerced here; a code node that wants the
   * native value reads it from `params.NAME` instead.
   */
  private parametersAsEntryInputs(): Record<string, string> {
    return Object.fromEntries(
      Object.entries(this.parameters).map(([name, value]) => [name, String(value)]),
    );
  }

  private resolveMappedInputValues(agentInput: AgentInput): Record<string, string> {
    const declaredInputs =
      this.config.inputs.length > 0 ? this.config.inputs : [{ identifier: "input", type: "str" }];

    if (this.config.scenarioMappings && Object.keys(this.config.scenarioMappings).length > 0) {
      const resolved = resolveFieldMappings({
        fieldMappings: this.config.scenarioMappings,
        agentInput,
      });
      const record: Record<string, string> = {};
      for (const inp of declaredInputs) {
        record[inp.identifier] = resolved[inp.identifier] ?? "";
      }
      return record;
    }

    let lastUserMessage: (typeof agentInput.messages)[number] | undefined;
    for (let index = agentInput.messages.length - 1; index >= 0; index -= 1) {
      const message = agentInput.messages[index];
      if (message?.role === "user") {
        lastUserMessage = message;
        break;
      }
    }
    const inputValue =
      typeof lastUserMessage?.content === "string"
        ? lastUserMessage.content
        : JSON.stringify(lastUserMessage?.content ?? "");

    const record: Record<string, string> = {};
    for (let i = 0; i < declaredInputs.length; i++) {
      record[declaredInputs[i]!.identifier] = i === 0 ? inputValue : "";
    }
    return record;
  }

  /**
   * Execute the pre-fetched workflow DSL via /go/studio/execute_sync. The DSL is passed through
   * unchanged (unlike the code adapter which synthesizes a minimal entry→code→end workflow). The
   * NLP service injects the inputs dict into the entry node when evaluating the graph.
   */
  private async executeOnNlpService(
    inputRecord: Record<string, string>,
  ): Promise<Record<string, unknown> | null> {
    // Merge pre-fetched project secrets into the DSL so `secrets.NAME` works
    // inside code nodes of the published workflow. Any secrets already embedded
    // in the DSL (there shouldn't be any — they're stripped on save) are
    // overwritten by the fresh values to avoid leaking stale/decrypted data.
    const existingSecrets =
      (this.config.workflow.secrets as Record<string, string> | undefined) ?? {};
    const workflow = {
      ...this.config.workflow,
      api_key: this.projectApiKey,
      secrets: { ...existingSecrets, ...this.config.secrets },
      params: this.turnParameters(),
    };

    const event = {
      type: "execute_flow" as const,
      payload: {
        trace_id: randomBytes(16).toString("hex"),
        workflow,
        inputs: [inputRecord],
        manual_execution_mode: false,
        do_not_trace: true,
        run_evaluations: false,
      },
    };

    const controller = new AbortController();
    const timeoutMs = fetchTimeoutMs(this.timeouts);
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await this.postExecuteSync({
        event,
        signal: controller.signal,
        timeoutMs,
      });

      if (!response.ok) {
        let errorMessage = "";
        try {
          const bodyStr = await response.text();
          try {
            const errorBody = JSON.parse(bodyStr) as { detail?: string };
            errorMessage = errorBody.detail ?? bodyStr;
          } catch {
            errorMessage = bodyStr;
          }
        } catch {
          errorMessage = "";
        }
        throw new Error(
          `Workflow execution failed: HTTP ${response.status}${
            errorMessage ? ` - ${errorMessage}` : ""
          }`,
        );
      }

      const result = JSON.parse(await response.text()) as {
        trace_id: string;
        status: string;
        result: Record<string, unknown> | null;
      };
      return result.result;
    } finally {
      clearTimeout(timeout);
    }
  }

  private async postExecuteSync({
    event,
    signal,
    timeoutMs,
  }: {
    event: unknown;
    signal: AbortSignal;
    timeoutMs: number;
  }): Promise<ExecuteSyncResponse> {
    try {
      return await this.transport.post({ event, signal, timeoutMs });
    } catch (fetchError) {
      const cause =
        fetchError instanceof Error && "cause" in fetchError
          ? ` (cause: ${String((fetchError as Error & { cause?: unknown }).cause)})`
          : "";
      throw new Error(
        `Workflow execution failed: fetch to ${this.transport.endpoint} failed - ${
          fetchError instanceof Error ? fetchError.message : String(fetchError)
        }${cause}`,
      );
    }
  }

  /**
   * Extract the output string from the NLP service response. When scenarioOutputField is set:
   * extract that specific field (throw if missing). When unset: use first declared output, then
   * first available value, then stringify the entire result.
   */
  private extractOutput(result: Record<string, unknown> | null): string {
    if (!result) return "";
    if (typeof result === "string") return result;

    const { scenarioOutputField } = this.config;

    if (scenarioOutputField) {
      if (scenarioOutputField in result) {
        return this.stringify(result[scenarioOutputField]);
      }
      throw new Error(
        `Scenario output field "${scenarioOutputField}" not found in agent output. Available fields: ${Object.keys(result).join(", ")}`,
      );
    }

    const firstOutputId = this.config.outputs[0]?.identifier ?? "output";
    const value = result[firstOutputId];
    if (value !== undefined) return this.stringify(value);

    const firstValue = Object.values(result)[0];
    if (firstValue !== undefined) return this.stringify(firstValue);

    return this.stringify(result);
  }

  private stringify(value: unknown): string {
    return typeof value === "string" ? value : JSON.stringify(value);
  }
}
