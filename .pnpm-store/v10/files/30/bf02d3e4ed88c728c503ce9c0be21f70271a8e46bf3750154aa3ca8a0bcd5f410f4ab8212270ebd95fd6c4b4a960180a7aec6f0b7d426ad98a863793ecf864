"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.Agent = void 0;
exports.saveAgentToolRunResult = saveAgentToolRunResult;
exports.consumeAgentToolRunResult = consumeAgentToolRunResult;
const zod_1 = require("zod");
const lifecycle_1 = require("./lifecycle.js");
const mcp_1 = require("./mcp.js");
const defaultModel_1 = require("./defaultModel.js");
const tool_1 = require("./tool.js");
const handoff_1 = require("./handoff.js");
const run_1 = require("./run.js");
const tools_1 = require("./utils/tools.js");
const messages_1 = require("./utils/messages.js");
const typeGuards_1 = require("./utils/typeGuards.js");
const typeGuards_2 = require("./utils/typeGuards.js");
const errors_1 = require("./errors.js");
const logger_1 = __importDefault(require("./logger.js"));
// Per-process, ephemeral map linking a function tool call to its nested
// Agent run result within the same run; entry is removed after consumption.
const agentToolRunResults = new WeakMap();
function saveAgentToolRunResult(toolCall, runResult) {
    if (toolCall) {
        agentToolRunResults.set(toolCall, runResult);
    }
}
function consumeAgentToolRunResult(toolCall) {
    const runResult = agentToolRunResults.get(toolCall);
    if (runResult) {
        agentToolRunResults.delete(toolCall);
    }
    return runResult;
}
// The parameter type fo needApproval function for the tool created by Agent.asTool() method
const AgentAsToolNeedApprovalSchame = zod_1.z.object({ input: zod_1.z.string() });
/**
 * The class representing an AI agent configured with instructions, tools, guardrails, handoffs and more.
 *
 * We strongly recommend passing `instructions`, which is the "system prompt" for the agent. In
 * addition, you can pass `handoffDescription`, which is a human-readable description of the
 * agent, used when the agent is used inside tools/handoffs.
 *
 * Agents are generic on the context type. The context is a (mutable) object you create. It is
 * passed to tool functions, handoffs, guardrails, etc.
 */
class Agent extends lifecycle_1.AgentHooks {
    /**
     * Create an Agent with handoffs and automatically infer the union type for TOutput from the handoff agents' output types.
     */
    static create(config) {
        return new Agent({
            ...config,
            handoffs: config.handoffs,
            outputType: config.outputType,
            handoffOutputTypeWarningEnabled: false,
        });
    }
    static DEFAULT_MODEL_PLACEHOLDER = '';
    name;
    instructions;
    prompt;
    handoffDescription;
    handoffs;
    model;
    modelSettings;
    tools;
    mcpServers;
    inputGuardrails;
    outputGuardrails;
    outputType = 'text';
    toolUseBehavior;
    resetToolChoice;
    _toolsExplicitlyConfigured;
    constructor(config) {
        super();
        if (typeof config.name !== 'string' || config.name.trim() === '') {
            throw new errors_1.UserError('Agent must have a name.');
        }
        this.name = config.name;
        this.instructions = config.instructions ?? Agent.DEFAULT_MODEL_PLACEHOLDER;
        this.prompt = config.prompt;
        this.handoffDescription = config.handoffDescription ?? '';
        this.handoffs = config.handoffs ?? [];
        this.model = config.model ?? '';
        this.modelSettings = config.modelSettings ?? (0, defaultModel_1.getDefaultModelSettings)();
        this.tools = config.tools ?? [];
        this._toolsExplicitlyConfigured = config.tools !== undefined;
        this.mcpServers = config.mcpServers ?? [];
        this.inputGuardrails = config.inputGuardrails ?? [];
        this.outputGuardrails = config.outputGuardrails ?? [];
        if (config.outputType) {
            this.outputType = config.outputType;
        }
        this.toolUseBehavior = config.toolUseBehavior ?? 'run_llm_again';
        this.resetToolChoice = config.resetToolChoice ?? true;
        if (
        // The user sets a non-default model
        config.model !== undefined &&
            // The default model is gpt-5
            (0, defaultModel_1.isGpt5Default)() &&
            // However, the specified model is not a gpt-5 model
            (typeof config.model !== 'string' ||
                !(0, defaultModel_1.gpt5ReasoningSettingsRequired)(config.model)) &&
            // The model settings are not customized for the specified model
            config.modelSettings === undefined) {
            // In this scenario, we should use a generic model settings
            // because non-gpt-5 models are not compatible with the default gpt-5 model settings.
            // This is a best-effort attempt to make the agent work with non-gpt-5 models.
            this.modelSettings = {};
        }
        // --- Runtime warning for handoff output type compatibility ---
        if (config.handoffOutputTypeWarningEnabled === undefined ||
            config.handoffOutputTypeWarningEnabled) {
            if (this.handoffs && this.outputType) {
                const outputTypes = new Set([JSON.stringify(this.outputType)]);
                for (const h of this.handoffs) {
                    if ('outputType' in h && h.outputType) {
                        outputTypes.add(JSON.stringify(h.outputType));
                    }
                    else if ('agent' in h && h.agent.outputType) {
                        outputTypes.add(JSON.stringify(h.agent.outputType));
                    }
                }
                if (outputTypes.size > 1) {
                    logger_1.default.warn(`[Agent] Warning: Handoff agents have different output types: ${Array.from(outputTypes).join(', ')}. You can make it type-safe by using Agent.create({ ... }) method instead.`);
                }
            }
        }
    }
    /**
     * Output schema name.
     */
    get outputSchemaName() {
        if (this.outputType === 'text') {
            return 'text';
        }
        else if ((0, typeGuards_2.isZodObject)(this.outputType)) {
            return 'ZodOutput';
        }
        else if (typeof this.outputType === 'object') {
            return this.outputType.name;
        }
        throw new Error(`Unknown output type: ${this.outputType}`);
    }
    /**
     * Makes a copy of the agent, with the given arguments changed. For example, you could do:
     *
     * ```
     * const newAgent = agent.clone({ instructions: 'New instructions' })
     * ```
     *
     * @param config - A partial configuration to change.
     * @returns A new agent with the given changes.
     */
    clone(config) {
        return new Agent({
            ...this,
            ...config,
        });
    }
    /**
     * Transform this agent into a tool, callable by other agents.
     *
     * This is different from handoffs in two ways:
     * 1. In handoffs, the new agent receives the conversation history. In this tool, the new agent
     *    receives generated input.
     * 2. In handoffs, the new agent takes over the conversation. In this tool, the new agent is
     *    called as a tool, and the conversation is continued by the original agent.
     *
     * @param options - Options for the tool.
     * @returns A tool that runs the agent and returns the output text.
     */
    asTool(options) {
        const { toolName, toolDescription, customOutputExtractor, needsApproval, runConfig, runOptions, isEnabled, onStream, } = options;
        // Event handlers are scoped to this agent tool instance and are not shared; we only support registration (no removal) to keep the API surface small.
        const eventHandlers = new Map();
        const emitEvent = async (event) => {
            // We intentionally keep only add semantics (no off) to reduce surface area; handlers are scoped to this agent tool instance.
            const specific = eventHandlers.get(event.event.type);
            const wildcard = eventHandlers.get('*');
            const candidates = [
                ...(onStream ? [onStream] : []),
                ...(specific ? Array.from(specific) : []),
                ...(wildcard ? Array.from(wildcard) : []),
            ];
            // Run all handlers in parallel so a slow onStream callback does not block on(...) handlers (and vice versa).
            await Promise.allSettled(candidates.map((handler) => Promise.resolve().then(() => handler(event))));
        };
        const baseTool = (0, tool_1.tool)({
            name: toolName ?? (0, tools_1.toFunctionToolName)(this.name),
            description: toolDescription ?? '',
            parameters: AgentAsToolNeedApprovalSchame,
            strict: true,
            needsApproval,
            isEnabled,
            execute: async (data, context, details) => {
                if (!(0, typeGuards_1.isAgentToolInput)(data)) {
                    throw new errors_1.ModelBehaviorError('Agent tool called with invalid input');
                }
                const runner = new run_1.Runner(runConfig ?? {});
                // Only flip to streaming mode when a handler is provided to avoid extra overhead for callers that do not need events.
                // Flip to streaming if either a legacy onStream callback or event handlers are registered; otherwise stay on the non-stream path to avoid extra overhead.
                const shouldStream = typeof onStream === 'function' || eventHandlers.size > 0;
                const result = shouldStream
                    ? await runner.run(this, data.input, {
                        context,
                        ...(runOptions ?? {}),
                        stream: true,
                    })
                    : await runner.run(this, data.input, {
                        context,
                        ...(runOptions ?? {}),
                    });
                const streamPayload = {
                    agent: this,
                    toolCall: details?.toolCall,
                };
                if (shouldStream) {
                    // Cast through unknown: the async iterator shape matches and we want to drain the stream for side effects while keeping the public API stable.
                    const streamResult = result;
                    // Drain the stream to deliver every event to registered handlers; ensure completion awaited so the nested run finishes before returning.
                    for await (const event of streamResult) {
                        await emitEvent({
                            event,
                            ...streamPayload,
                        });
                    }
                    await streamResult.completed;
                }
                const completedResult = result;
                const usesStopAtToolNames = typeof this.toolUseBehavior === 'object' &&
                    this.toolUseBehavior !== null &&
                    'stopAtToolNames' in this.toolUseBehavior;
                if (typeof customOutputExtractor !== 'function' &&
                    usesStopAtToolNames) {
                    logger_1.default.debug(`You're passing the agent (name: ${this.name}) with toolUseBehavior.stopAtToolNames configured as a tool to a different agent; this may not work as you expect. You may want to have a wrapper function tool to consistently return the final output.`);
                }
                const outputText = typeof customOutputExtractor === 'function'
                    ? await customOutputExtractor(completedResult)
                    : (0, messages_1.getOutputText)(completedResult.rawResponses[completedResult.rawResponses.length - 1]);
                if (details?.toolCall) {
                    saveAgentToolRunResult(details.toolCall, completedResult);
                }
                return outputText;
            },
        });
        const agentTool = {
            ...baseTool,
            on: (name, handler) => {
                const set = eventHandlers.get(name) ?? new Set();
                set.add(handler);
                eventHandlers.set(name, set);
                return agentTool;
            },
        };
        return agentTool;
    }
    /**
     * Returns the system prompt for the agent.
     *
     * If the agent has a function as its instructions, this function will be called with the
     * runContext and the agent instance.
     */
    async getSystemPrompt(runContext) {
        if (typeof this.instructions === 'function') {
            return await this.instructions(runContext, this);
        }
        return this.instructions;
    }
    /**
     * Returns the prompt template for the agent, if defined.
     *
     * If the agent has a function as its prompt, this function will be called with the
     * runContext and the agent instance.
     */
    async getPrompt(runContext) {
        if (typeof this.prompt === 'function') {
            return await this.prompt(runContext, this);
        }
        return this.prompt;
    }
    /**
     * Fetches the available tools from the MCP servers.
     * @returns the MCP powered tools
     */
    async getMcpTools(runContext) {
        if (this.mcpServers.length > 0) {
            return (0, mcp_1.getAllMcpTools)({
                mcpServers: this.mcpServers,
                runContext,
                agent: this,
                convertSchemasToStrict: false,
            });
        }
        return [];
    }
    /**
     * ALl agent tools, including the MCPl and function tools.
     *
     * @returns all configured tools
     */
    async getAllTools(runContext) {
        const mcpTools = await this.getMcpTools(runContext);
        const enabledTools = [];
        for (const candidate of this.tools) {
            if (candidate.type === 'function') {
                const maybeIsEnabled = candidate.isEnabled;
                const enabled = typeof maybeIsEnabled === 'function'
                    ? await maybeIsEnabled(runContext, this)
                    : typeof maybeIsEnabled === 'boolean'
                        ? maybeIsEnabled
                        : true;
                if (!enabled) {
                    continue;
                }
            }
            enabledTools.push(candidate);
        }
        return [...mcpTools, ...enabledTools];
    }
    hasExplicitToolConfig() {
        return this._toolsExplicitlyConfigured;
    }
    /**
     * Returns the handoffs that should be exposed to the model for the current run.
     *
     * Handoffs that provide an `isEnabled` function returning `false` are omitted.
     */
    async getEnabledHandoffs(runContext) {
        const handoffs = this.handoffs?.map((h) => (0, handoff_1.getHandoff)(h)) ?? [];
        const enabled = [];
        for (const handoff of handoffs) {
            if (await handoff.isEnabled({ runContext, agent: this })) {
                enabled.push(handoff);
            }
        }
        return enabled;
    }
    /**
     * Processes the final output of the agent.
     *
     * @param output - The output of the agent.
     * @returns The parsed out.
     */
    processFinalOutput(output) {
        if (this.outputType === 'text') {
            return output;
        }
        if (typeof this.outputType === 'object') {
            const parsed = JSON.parse(output);
            if ((0, typeGuards_2.isZodObject)(this.outputType)) {
                return this.outputType.parse(parsed);
            }
            return parsed;
        }
        throw new Error(`Unknown output type: ${this.outputType}`);
    }
    /**
     * Returns a JSON representation of the agent, which is serializable.
     *
     * @returns A JSON object containing the agent's name.
     */
    toJSON() {
        return {
            name: this.name,
        };
    }
}
exports.Agent = Agent;
//# sourceMappingURL=agent.js.map