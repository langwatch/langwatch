import { z } from 'zod';
import { Agent } from "./agent.mjs";
import { RunMessageOutputItem, RunToolApprovalItem, RunToolCallItem, RunToolCallOutputItem, RunReasoningItem, RunHandoffCallItem, RunHandoffOutputItem, } from "./items.mjs";
import { RunContext } from "./runContext.mjs";
import { getTurnInput } from "./runner/items.mjs";
import { AgentToolUseTracker } from "./runner/toolUseTracker.mjs";
import { nextStepSchema } from "./runner/steps.mjs";
import { SystemError, UserError } from "./errors.mjs";
import { getGlobalTraceProvider } from "./tracing/provider.mjs";
import { Usage } from "./usage.mjs";
import { getCurrentTrace } from "./tracing/index.mjs";
import logger from "./logger.mjs";
import { handoff } from "./handoff.mjs";
import * as protocol from "./types/protocol.mjs";
import { safeExecute } from "./utils/safeExecute.mjs";
/**
 * The schema version of the serialized run state. This is used to ensure that the serialized
 * run state is compatible with the current version of the SDK.
 * If anything in this schema changes, the version will have to be incremented.
 *
 * Version history.
 * - 1.0: Initial serialized RunState schema.
 * - 1.1: Adds optional currentTurnInProgress, conversationId, and previousResponseId fields,
 *   plus broader tool_call_output_item rawItem variants for non-function tools. Older 1.0
 *   payloads remain readable but resumes may lack mid-turn or server-managed context precision.
 */
export const CURRENT_SCHEMA_VERSION = '1.1';
const SUPPORTED_SCHEMA_VERSIONS = ['1.0', CURRENT_SCHEMA_VERSION];
const $schemaVersion = z.enum(SUPPORTED_SCHEMA_VERSIONS);
const serializedAgentSchema = z.object({
    name: z.string(),
});
const serializedSpanBase = z.object({
    object: z.literal('trace.span'),
    id: z.string(),
    trace_id: z.string(),
    parent_id: z.string().nullable(),
    started_at: z.string().nullable(),
    ended_at: z.string().nullable(),
    error: z
        .object({
        message: z.string(),
        data: z.record(z.string(), z.any()).optional(),
    })
        .nullable(),
    span_data: z.record(z.string(), z.any()),
});
const SerializedSpan = serializedSpanBase.extend({
    previous_span: z.lazy(() => SerializedSpan).optional(),
});
const requestUsageSchema = z.object({
    inputTokens: z.number(),
    outputTokens: z.number(),
    totalTokens: z.number(),
    inputTokensDetails: z.record(z.string(), z.number()).optional(),
    outputTokensDetails: z.record(z.string(), z.number()).optional(),
    endpoint: z.string().optional(),
});
const usageSchema = z.object({
    requests: z.number(),
    inputTokens: z.number(),
    outputTokens: z.number(),
    totalTokens: z.number(),
    inputTokensDetails: z.array(z.record(z.string(), z.number())).optional(),
    outputTokensDetails: z.array(z.record(z.string(), z.number())).optional(),
    requestUsageEntries: z.array(requestUsageSchema).optional(),
});
const modelResponseSchema = z.object({
    usage: usageSchema,
    output: z.array(protocol.OutputModelItem),
    responseId: z.string().optional(),
    providerData: z.record(z.string(), z.any()).optional(),
});
const itemSchema = z.discriminatedUnion('type', [
    z.object({
        type: z.literal('message_output_item'),
        rawItem: protocol.AssistantMessageItem,
        agent: serializedAgentSchema,
    }),
    z.object({
        type: z.literal('tool_call_item'),
        rawItem: protocol.ToolCallItem.or(protocol.HostedToolCallItem),
        agent: serializedAgentSchema,
    }),
    z.object({
        type: z.literal('tool_call_output_item'),
        rawItem: protocol.FunctionCallResultItem.or(protocol.ComputerCallResultItem)
            .or(protocol.ShellCallResultItem)
            .or(protocol.ApplyPatchCallResultItem),
        agent: serializedAgentSchema,
        output: z.string(),
    }),
    z.object({
        type: z.literal('reasoning_item'),
        rawItem: protocol.ReasoningItem,
        agent: serializedAgentSchema,
    }),
    z.object({
        type: z.literal('handoff_call_item'),
        rawItem: protocol.FunctionCallItem,
        agent: serializedAgentSchema,
    }),
    z.object({
        type: z.literal('handoff_output_item'),
        rawItem: protocol.FunctionCallResultItem,
        sourceAgent: serializedAgentSchema,
        targetAgent: serializedAgentSchema,
    }),
    z.object({
        type: z.literal('tool_approval_item'),
        rawItem: protocol.FunctionCallItem.or(protocol.HostedToolCallItem)
            .or(protocol.ShellCallItem)
            .or(protocol.ApplyPatchCallItem),
        agent: serializedAgentSchema,
        toolName: z.string().optional(),
    }),
]);
const serializedTraceSchema = z.object({
    object: z.literal('trace'),
    id: z.string(),
    workflow_name: z.string(),
    group_id: z.string().nullable(),
    metadata: z.record(z.string(), z.any()),
    // Populated only if the trace was created with a per-run tracingApiKey (e.g., Runner.run({ tracing: { apiKey } }))
    // and serialization opts in to include it. By default this is omitted to avoid persisting secrets.
    tracing_api_key: z.string().optional().nullable(),
});
const serializedProcessedResponseSchema = z.object({
    newItems: z.array(itemSchema),
    toolsUsed: z.array(z.string()),
    handoffs: z.array(z.object({
        toolCall: z.any(),
        handoff: z.any(),
    })),
    functions: z.array(z.object({
        toolCall: z.any(),
        tool: z.any(),
    })),
    computerActions: z.array(z.object({
        toolCall: z.any(),
        computer: z.any(),
    })),
    shellActions: z
        .array(z.object({
        toolCall: z.any(),
        shell: z.any(),
    }))
        .optional(),
    applyPatchActions: z
        .array(z.object({
        toolCall: z.any(),
        applyPatch: z.any(),
    }))
        .optional(),
    mcpApprovalRequests: z
        .array(z.object({
        requestItem: z.object({
            // protocol.HostedToolCallItem
            rawItem: z.object({
                type: z.literal('hosted_tool_call'),
                name: z.string(),
                arguments: z.string().optional(),
                status: z.string().optional(),
                output: z.string().optional(),
                // this always exists but marked as optional for early version compatibility; when releasing 1.0, we can remove the nullable and optional
                providerData: z.record(z.string(), z.any()).nullable().optional(),
            }),
        }),
        // HostedMCPTool
        mcpTool: z.object({
            type: z.literal('hosted_tool'),
            name: z.literal('hosted_mcp'),
            providerData: z.record(z.string(), z.any()),
        }),
    }))
        .optional(),
});
const guardrailFunctionOutputSchema = z.object({
    tripwireTriggered: z.boolean(),
    outputInfo: z.any(),
});
const toolGuardrailBehaviorSchema = z.discriminatedUnion('type', [
    z.object({ type: z.literal('allow') }),
    z.object({
        type: z.literal('rejectContent'),
        message: z.string(),
    }),
    z.object({ type: z.literal('throwException') }),
]);
const toolGuardrailFunctionOutputSchema = z.object({
    outputInfo: z.any().optional(),
    behavior: toolGuardrailBehaviorSchema,
});
const toolGuardrailMetadataSchema = z.object({
    type: z.union([z.literal('tool_input'), z.literal('tool_output')]),
    name: z.string(),
});
const inputGuardrailResultSchema = z.object({
    guardrail: z.object({
        type: z.literal('input'),
        name: z.string(),
    }),
    output: guardrailFunctionOutputSchema,
});
const outputGuardrailResultSchema = z.object({
    guardrail: z.object({
        type: z.literal('output'),
        name: z.string(),
    }),
    agentOutput: z.any(),
    agent: serializedAgentSchema,
    output: guardrailFunctionOutputSchema,
});
const toolInputGuardrailResultSchema = z.object({
    guardrail: toolGuardrailMetadataSchema.extend({
        type: z.literal('tool_input'),
    }),
    output: toolGuardrailFunctionOutputSchema,
});
const toolOutputGuardrailResultSchema = z.object({
    guardrail: toolGuardrailMetadataSchema.extend({
        type: z.literal('tool_output'),
    }),
    output: toolGuardrailFunctionOutputSchema,
});
export const SerializedRunState = z.object({
    $schemaVersion,
    currentTurn: z.number(),
    currentAgent: serializedAgentSchema,
    originalInput: z.string().or(z.array(protocol.ModelItem)),
    modelResponses: z.array(modelResponseSchema),
    context: z.object({
        usage: usageSchema,
        approvals: z.record(z.string(), z.object({
            approved: z.array(z.string()).or(z.boolean()),
            rejected: z.array(z.string()).or(z.boolean()),
        })),
        context: z.record(z.string(), z.any()),
    }),
    toolUseTracker: z.record(z.string(), z.array(z.string())),
    maxTurns: z.number(),
    currentAgentSpan: SerializedSpan.nullable().optional(),
    noActiveAgentRun: z.boolean(),
    inputGuardrailResults: z.array(inputGuardrailResultSchema),
    outputGuardrailResults: z.array(outputGuardrailResultSchema),
    toolInputGuardrailResults: z
        .array(toolInputGuardrailResultSchema)
        .optional()
        .default([]),
    toolOutputGuardrailResults: z
        .array(toolOutputGuardrailResultSchema)
        .optional()
        .default([]),
    currentTurnInProgress: z.boolean().optional(),
    currentStep: nextStepSchema.optional(),
    lastModelResponse: modelResponseSchema.optional(),
    generatedItems: z.array(itemSchema),
    lastProcessedResponse: serializedProcessedResponseSchema.optional(),
    currentTurnPersistedItemCount: z.number().int().min(0).optional(),
    conversationId: z.string().optional(),
    previousResponseId: z.string().optional(),
    trace: serializedTraceSchema.nullable(),
});
/**
 * Serializable snapshot of an agent's run, including context, usage and trace.
 * While this class has publicly writable properties (prefixed with `_`), they are not meant to be
 * used directly. To read these properties, use the `RunResult` instead.
 *
 * Manipulation of the state directly can lead to unexpected behavior and should be avoided.
 * Instead, use the `approve` and `reject` methods to interact with the state.
 */
export class RunState {
    /**
     * Current turn number in the conversation.
     */
    _currentTurn = 0;
    /**
     * Whether the current turn has already been counted (useful when resuming mid-turn).
     */
    _currentTurnInProgress = false;
    /**
     * The agent currently handling the conversation.
     */
    _currentAgent;
    /**
     * Original user input prior to any processing.
     */
    _originalInput;
    /**
     * Responses from the model so far.
     */
    _modelResponses;
    /**
     * Conversation identifier when the server manages conversation history.
     */
    _conversationId;
    /**
     * Latest response identifier returned by the server for server-managed conversations.
     */
    _previousResponseId;
    /**
     * Active tracing span for the current agent if tracing is enabled.
     */
    _currentAgentSpan;
    /**
     * Run context tracking approvals, usage, and other metadata.
     */
    _context;
    /**
     * The usage aggregated for this run. This includes per-request breakdowns when available.
     */
    get usage() {
        return this._context.usage;
    }
    /**
     * Tracks what tools each agent has used.
     */
    _toolUseTracker;
    /**
     * Items generated by the agent during the run.
     */
    _generatedItems;
    /**
     * Number of `_generatedItems` already flushed to session storage for the current turn.
     *
     * Persisting the entire turn on every save would duplicate responses and tool outputs.
     * Instead, `saveToSession` appends only the delta since the previous write. This counter
     * tracks how many generated run items from *this turn* were already written so the next
     * save can slice off only the new entries. When a turn is interrupted (e.g., awaiting tool
     * approval) and later resumed, we rewind the counter before continuing so the pending tool
     * output still gets stored.
     */
    _currentTurnPersistedItemCount;
    /**
     * Maximum allowed turns before forcing termination.
     */
    _maxTurns;
    /**
     * Whether the run has an active agent step in progress.
     */
    _noActiveAgentRun = true;
    /**
     * Last model response for the previous turn.
     */
    _lastTurnResponse;
    /**
     * Results from input guardrails applied to the run.
     */
    _inputGuardrailResults;
    /**
     * Results from output guardrails applied to the run.
     */
    _outputGuardrailResults;
    /**
     * Results from tool input guardrails applied during tool execution.
     */
    _toolInputGuardrailResults;
    /**
     * Results from tool output guardrails applied during tool execution.
     */
    _toolOutputGuardrailResults;
    /**
     * Next step computed for the agent to take.
     */
    _currentStep = undefined;
    /**
     * Parsed model response after applying guardrails and tools.
     */
    _lastProcessedResponse = undefined;
    /**
     * Trace associated with this run if tracing is enabled.
     */
    _trace = null;
    constructor(context, originalInput, startingAgent, maxTurns) {
        this._context = context;
        this._originalInput = structuredClone(originalInput);
        this._modelResponses = [];
        this._currentAgentSpan = undefined;
        this._currentAgent = startingAgent;
        this._toolUseTracker = new AgentToolUseTracker();
        this._generatedItems = [];
        this._currentTurnPersistedItemCount = 0;
        this._maxTurns = maxTurns;
        this._inputGuardrailResults = [];
        this._outputGuardrailResults = [];
        this._toolInputGuardrailResults = [];
        this._toolOutputGuardrailResults = [];
        this._trace = getCurrentTrace();
    }
    /**
     * Updates server-managed conversation identifiers as a single operation.
     */
    setConversationContext(conversationId, previousResponseId) {
        this._conversationId = conversationId;
        this._previousResponseId = previousResponseId;
    }
    /**
     * Updates the agent span associated with the current run.
     */
    setCurrentAgentSpan(span) {
        this._currentAgentSpan = span;
    }
    /**
     * Switches the active agent handling the run.
     */
    setCurrentAgent(agent) {
        this._currentAgent = agent;
    }
    /**
     * Resets the counter that tracks how many items were persisted for the current turn.
     */
    resetTurnPersistence() {
        this._currentTurnPersistedItemCount = 0;
    }
    /**
     * Rewinds the persisted item counter when pending approvals require re-writing outputs.
     */
    rewindTurnPersistence(count) {
        if (count <= 0) {
            return;
        }
        this._currentTurnPersistedItemCount = Math.max(0, this._currentTurnPersistedItemCount - count);
    }
    /**
     * The history of the agent run. This includes the input items and the new items generated during the run.
     *
     * This can be used as inputs for the next agent run.
     */
    get history() {
        return getTurnInput(this._originalInput, this._generatedItems);
    }
    /**
     * Returns all interruptions if the current step is an interruption otherwise returns an empty array.
     */
    getInterruptions() {
        if (this._currentStep?.type !== 'next_step_interruption') {
            return [];
        }
        return this._currentStep.data.interruptions;
    }
    /**
     * Approves a tool call requested by the agent through an interruption and approval item request.
     *
     * To approve the request use this method and then run the agent again with the same state object
     * to continue the execution.
     *
     * By default it will only approve the current tool call. To allow the tool to be used multiple
     * times throughout the run, set the `alwaysApprove` option to `true`.
     *
     * @param approvalItem - The tool call approval item to approve.
     * @param options - Options for the approval.
     */
    approve(approvalItem, options = { alwaysApprove: false }) {
        this._context.approveTool(approvalItem, options);
    }
    /**
     * Rejects a tool call requested by the agent through an interruption and approval item request.
     *
     * To reject the request use this method and then run the agent again with the same state object
     * to continue the execution.
     *
     * By default it will only reject the current tool call. To allow the tool to be used multiple
     * times throughout the run, set the `alwaysReject` option to `true`.
     *
     * @param approvalItem - The tool call approval item to reject.
     * @param options - Options for the rejection.
     */
    reject(approvalItem, options = { alwaysReject: false }) {
        this._context.rejectTool(approvalItem, options);
    }
    /**
     * Serializes the run state to a JSON object.
     *
     * This method is used to serialize the run state to a JSON object that can be used to
     * resume the run later.
     *
     * @returns The serialized run state.
     */
    /**
     * Serializes the run state. By default, tracing API keys are omitted to prevent
     * accidental persistence of secrets. Pass `includeTracingApiKey: true` only when you
     * intentionally need to migrate a run along with its tracing credentials (e.g., to
     * rehydrate in a separate process that lacks the original environment variables).
     */
    toJSON(options = {}) {
        const includeTracingApiKey = options.includeTracingApiKey === true;
        const output = {
            $schemaVersion: CURRENT_SCHEMA_VERSION,
            currentTurn: this._currentTurn,
            currentAgent: {
                name: this._currentAgent.name,
            },
            originalInput: this._originalInput,
            modelResponses: this._modelResponses.map((response) => {
                return {
                    usage: {
                        requests: response.usage.requests,
                        inputTokens: response.usage.inputTokens,
                        outputTokens: response.usage.outputTokens,
                        totalTokens: response.usage.totalTokens,
                        inputTokensDetails: response.usage.inputTokensDetails,
                        outputTokensDetails: response.usage.outputTokensDetails,
                        ...(response.usage.requestUsageEntries &&
                            response.usage.requestUsageEntries.length > 0
                            ? {
                                requestUsageEntries: response.usage.requestUsageEntries.map((entry) => ({
                                    inputTokens: entry.inputTokens,
                                    outputTokens: entry.outputTokens,
                                    totalTokens: entry.totalTokens,
                                    inputTokensDetails: entry.inputTokensDetails,
                                    outputTokensDetails: entry.outputTokensDetails,
                                    ...(entry.endpoint ? { endpoint: entry.endpoint } : {}),
                                })),
                            }
                            : {}),
                    },
                    output: response.output,
                    responseId: response.responseId,
                    providerData: response.providerData,
                };
            }),
            context: this._context.toJSON(),
            toolUseTracker: this._toolUseTracker.toJSON(),
            maxTurns: this._maxTurns,
            currentAgentSpan: this._currentAgentSpan?.toJSON(),
            noActiveAgentRun: this._noActiveAgentRun,
            currentTurnInProgress: this._currentTurnInProgress,
            inputGuardrailResults: this._inputGuardrailResults,
            outputGuardrailResults: this._outputGuardrailResults.map((r) => ({
                ...r,
                agent: r.agent.toJSON(),
            })),
            toolInputGuardrailResults: this._toolInputGuardrailResults,
            toolOutputGuardrailResults: this._toolOutputGuardrailResults,
            currentStep: this._currentStep,
            lastModelResponse: this._lastTurnResponse,
            generatedItems: this._generatedItems.map((item) => item.toJSON()),
            currentTurnPersistedItemCount: this._currentTurnPersistedItemCount,
            lastProcessedResponse: this._lastProcessedResponse,
            conversationId: this._conversationId,
            previousResponseId: this._previousResponseId,
            trace: this._trace
                ? this._trace.toJSON({ includeTracingApiKey })
                : null,
        };
        // parsing the schema to ensure the output is valid for reparsing
        const parsed = SerializedRunState.safeParse(output);
        if (!parsed.success) {
            throw new SystemError(`Failed to serialize run state. ${parsed.error.message}`);
        }
        return parsed.data;
    }
    /**
     * Serializes the run state to a string.
     *
     * This method is used to serialize the run state to a string that can be used to
     * resume the run later.
     *
     * @returns The serialized run state.
     */
    toString(options = {}) {
        return JSON.stringify(this.toJSON(options));
    }
    /**
     * Deserializes a run state from a string.
     *
     * This method is used to deserialize a run state from a string that was serialized using the
     * `toString` method.
     */
    static async fromString(initialAgent, str) {
        const [parsingError, jsonResult] = await safeExecute(() => JSON.parse(str));
        if (parsingError) {
            throw new UserError(`Failed to parse run state. ${parsingError instanceof Error ? parsingError.message : String(parsingError)}`);
        }
        const currentSchemaVersion = jsonResult.$schemaVersion;
        if (!currentSchemaVersion) {
            throw new UserError('Run state is missing schema version');
        }
        if (!SUPPORTED_SCHEMA_VERSIONS.includes(currentSchemaVersion)) {
            throw new UserError(`Run state schema version ${currentSchemaVersion} is not supported. Please use version ${CURRENT_SCHEMA_VERSION}.`);
        }
        const stateJson = SerializedRunState.parse(JSON.parse(str));
        const agentMap = buildAgentMap(initialAgent);
        //
        // Rebuild the context
        //
        const context = new RunContext(stateJson.context.context);
        context._rebuildApprovals(stateJson.context.approvals);
        //
        // Find the current agent from the initial agent
        //
        const currentAgent = agentMap.get(stateJson.currentAgent.name);
        if (!currentAgent) {
            throw new UserError(`Agent ${stateJson.currentAgent.name} not found`);
        }
        const state = new RunState(context, '', currentAgent, stateJson.maxTurns);
        state._currentTurn = stateJson.currentTurn;
        state._currentTurnInProgress = stateJson.currentTurnInProgress ?? false;
        state._conversationId = stateJson.conversationId ?? undefined;
        state._previousResponseId = stateJson.previousResponseId ?? undefined;
        // rebuild tool use tracker
        state._toolUseTracker = new AgentToolUseTracker();
        for (const [agentName, toolNames] of Object.entries(stateJson.toolUseTracker)) {
            state._toolUseTracker.addToolUse(agentMap.get(agentName), toolNames, { allowEmpty: true });
        }
        // rebuild current agent span
        if (stateJson.currentAgentSpan) {
            if (!stateJson.trace) {
                logger.warn('Trace is not set, skipping tracing setup');
            }
            const trace = getGlobalTraceProvider().createTrace({
                traceId: stateJson.trace?.id,
                name: stateJson.trace?.workflow_name,
                groupId: stateJson.trace?.group_id ?? undefined,
                metadata: stateJson.trace?.metadata,
                tracingApiKey: stateJson.trace?.tracing_api_key ?? undefined,
            });
            state._currentAgentSpan = deserializeSpan(trace, stateJson.currentAgentSpan);
            state._trace = trace;
        }
        state._noActiveAgentRun = stateJson.noActiveAgentRun;
        state._inputGuardrailResults =
            stateJson.inputGuardrailResults;
        state._outputGuardrailResults = stateJson.outputGuardrailResults.map((r) => ({
            ...r,
            agent: agentMap.get(r.agent.name),
        }));
        state._toolInputGuardrailResults =
            stateJson.toolInputGuardrailResults;
        state._toolOutputGuardrailResults =
            stateJson.toolOutputGuardrailResults;
        state._currentStep = stateJson.currentStep;
        state._originalInput = stateJson.originalInput;
        state._modelResponses = stateJson.modelResponses.map(deserializeModelResponse);
        state._lastTurnResponse = stateJson.lastModelResponse
            ? deserializeModelResponse(stateJson.lastModelResponse)
            : undefined;
        state._generatedItems = stateJson.generatedItems.map((item) => deserializeItem(item, agentMap));
        state._currentTurnPersistedItemCount =
            stateJson.currentTurnPersistedItemCount ?? 0;
        state._lastProcessedResponse = stateJson.lastProcessedResponse
            ? await deserializeProcessedResponse(agentMap, state._currentAgent, state._context, stateJson.lastProcessedResponse)
            : undefined;
        if (stateJson.currentStep?.type === 'next_step_handoff') {
            state._currentStep = {
                type: 'next_step_handoff',
                newAgent: agentMap.get(stateJson.currentStep.newAgent.name),
            };
        }
        return state;
    }
}
/**
 * @internal
 */
export function buildAgentMap(initialAgent) {
    const map = new Map();
    const queue = [initialAgent];
    while (queue.length > 0) {
        const currentAgent = queue.shift();
        if (map.has(currentAgent.name)) {
            continue;
        }
        map.set(currentAgent.name, currentAgent);
        for (const handoff of currentAgent.handoffs) {
            if (handoff instanceof Agent) {
                if (!map.has(handoff.name)) {
                    queue.push(handoff);
                }
            }
            else if (handoff.agent) {
                if (!map.has(handoff.agent.name)) {
                    queue.push(handoff.agent);
                }
            }
        }
    }
    return map;
}
/**
 * @internal
 */
export function deserializeSpan(trace, serializedSpan) {
    const spanData = serializedSpan.span_data;
    const previousSpan = serializedSpan.previous_span
        ? deserializeSpan(trace, serializedSpan.previous_span)
        : undefined;
    const span = getGlobalTraceProvider().createSpan({
        spanId: serializedSpan.id,
        traceId: serializedSpan.trace_id,
        parentId: serializedSpan.parent_id ?? undefined,
        startedAt: serializedSpan.started_at ?? undefined,
        endedAt: serializedSpan.ended_at ?? undefined,
        data: spanData,
    }, trace);
    span.previousSpan = previousSpan;
    return span;
}
/**
 * @internal
 */
export function deserializeModelResponse(serializedModelResponse) {
    const usage = new Usage(serializedModelResponse.usage);
    return {
        usage,
        output: serializedModelResponse.output.map((item) => protocol.OutputModelItem.parse(item)),
        responseId: serializedModelResponse.responseId,
        providerData: serializedModelResponse.providerData,
    };
}
/**
 * @internal
 */
export function deserializeItem(serializedItem, agentMap) {
    switch (serializedItem.type) {
        case 'message_output_item':
            return new RunMessageOutputItem(serializedItem.rawItem, agentMap.get(serializedItem.agent.name));
        case 'tool_call_item':
            return new RunToolCallItem(serializedItem.rawItem, agentMap.get(serializedItem.agent.name));
        case 'tool_call_output_item':
            return new RunToolCallOutputItem(serializedItem.rawItem, agentMap.get(serializedItem.agent.name), serializedItem.output);
        case 'reasoning_item':
            return new RunReasoningItem(serializedItem.rawItem, agentMap.get(serializedItem.agent.name));
        case 'handoff_call_item':
            return new RunHandoffCallItem(serializedItem.rawItem, agentMap.get(serializedItem.agent.name));
        case 'handoff_output_item':
            return new RunHandoffOutputItem(serializedItem.rawItem, agentMap.get(serializedItem.sourceAgent.name), agentMap.get(serializedItem.targetAgent.name));
        case 'tool_approval_item':
            return new RunToolApprovalItem(serializedItem.rawItem, agentMap.get(serializedItem.agent.name), serializedItem.toolName);
    }
}
/**
 * @internal
 */
async function deserializeProcessedResponse(agentMap, currentAgent, context, serializedProcessedResponse) {
    const allTools = await currentAgent.getAllTools(context);
    const tools = new Map(allTools
        .filter((tool) => tool.type === 'function')
        .map((tool) => [tool.name, tool]));
    const computerTools = new Map(allTools
        .filter((tool) => tool.type === 'computer')
        .map((tool) => [tool.name, tool]));
    const shellTools = new Map(allTools
        .filter((tool) => tool.type === 'shell')
        .map((tool) => [tool.name, tool]));
    const applyPatchTools = new Map(allTools
        .filter((tool) => tool.type === 'apply_patch')
        .map((tool) => [tool.name, tool]));
    const handoffs = new Map(currentAgent.handoffs.map((entry) => {
        if (entry instanceof Agent) {
            return [entry.name, handoff(entry)];
        }
        return [entry.toolName, entry];
    }));
    const result = {
        newItems: serializedProcessedResponse.newItems.map((item) => deserializeItem(item, agentMap)),
        toolsUsed: serializedProcessedResponse.toolsUsed,
        handoffs: serializedProcessedResponse.handoffs.map((handoff) => {
            if (!handoffs.has(handoff.handoff.toolName)) {
                throw new UserError(`Handoff ${handoff.handoff.toolName} not found`);
            }
            return {
                toolCall: handoff.toolCall,
                handoff: handoffs.get(handoff.handoff.toolName),
            };
        }),
        functions: await Promise.all(serializedProcessedResponse.functions.map(async (functionCall) => {
            if (!tools.has(functionCall.tool.name)) {
                throw new UserError(`Tool ${functionCall.tool.name} not found`);
            }
            return {
                toolCall: functionCall.toolCall,
                tool: tools.get(functionCall.tool.name),
            };
        })),
        computerActions: serializedProcessedResponse.computerActions.map((computerAction) => {
            const toolName = computerAction.computer.name;
            if (!computerTools.has(toolName)) {
                throw new UserError(`Computer tool ${toolName} not found`);
            }
            return {
                toolCall: computerAction.toolCall,
                computer: computerTools.get(toolName),
            };
        }),
        shellActions: (serializedProcessedResponse.shellActions ?? []).map((shellAction) => {
            const toolName = shellAction.shell.name;
            if (!shellTools.has(toolName)) {
                throw new UserError(`Shell tool ${toolName} not found`);
            }
            return {
                toolCall: shellAction.toolCall,
                shell: shellTools.get(toolName),
            };
        }),
        applyPatchActions: (serializedProcessedResponse.applyPatchActions ?? []).map((applyPatchAction) => {
            const toolName = applyPatchAction.applyPatch.name;
            if (!applyPatchTools.has(toolName)) {
                throw new UserError(`Apply patch tool ${toolName} not found`);
            }
            return {
                toolCall: applyPatchAction.toolCall,
                applyPatch: applyPatchTools.get(toolName),
            };
        }),
        mcpApprovalRequests: (serializedProcessedResponse.mcpApprovalRequests ?? []).map((approvalRequest) => ({
            requestItem: new RunToolApprovalItem(approvalRequest.requestItem
                .rawItem, currentAgent),
            mcpTool: approvalRequest.mcpTool,
        })),
    };
    return {
        ...result,
        hasToolsOrApprovalsToRun() {
            return (result.handoffs.length > 0 ||
                result.functions.length > 0 ||
                result.mcpApprovalRequests.length > 0 ||
                result.computerActions.length > 0 ||
                result.shellActions.length > 0 ||
                result.applyPatchActions.length > 0);
        },
    };
}
//# sourceMappingURL=runState.mjs.map