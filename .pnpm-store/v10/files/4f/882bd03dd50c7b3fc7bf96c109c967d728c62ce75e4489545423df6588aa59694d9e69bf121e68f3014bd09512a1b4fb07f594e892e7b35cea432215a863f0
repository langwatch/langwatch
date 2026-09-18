import { z } from 'zod';
import type { InputGuardrail, OutputGuardrail } from './guardrail';
import { AgentHooks } from './lifecycle';
import { type MCPServer } from './mcp';
import type { Model, ModelSettings, Prompt } from './model';
import type { RunContext } from './runContext';
import { type FunctionTool, type FunctionToolResult, type Tool, type ToolApprovalFunction } from './tool';
import type { ResolvedAgentOutput, JsonSchemaDefinition, HandoffsOutput, Expand } from './types';
import type { RunResult, StreamedRunResult } from './result';
import { type Handoff } from './handoff';
import { StreamRunOptions, RunConfig } from './run';
import { RunToolApprovalItem } from './items';
import { UnknownContext, TextOutput } from './types';
import type * as protocol from './types/protocol';
import type { ZodObjectLike } from './utils/zodCompat';
import type { RunStreamEvent } from './events';
type AnyAgentRunResult = RunResult<any, Agent<any, any>> | StreamedRunResult<any, Agent<any, any>>;
type CompletedRunResult<TContext, TAgent extends Agent<TContext, any>> = (RunResult<TContext, TAgent> | StreamedRunResult<TContext, TAgent>) & {
    finalOutput: ResolvedAgentOutput<TAgent['outputType']>;
};
type AgentToolRunOptions<TContext> = Omit<StreamRunOptions<TContext>, 'stream'>;
type AgentToolStreamEvent<TAgent extends Agent<any, any>> = {
    event: RunStreamEvent;
    agent: TAgent;
    toolCall?: protocol.FunctionCallItem;
};
type AgentToolEventName = RunStreamEvent['type'] | '*';
type AgentToolEventHandler<TAgent extends Agent<any, any>> = (event: AgentToolStreamEvent<TAgent>) => void | Promise<void>;
type AgentTool<TContext, TAgent extends Agent<TContext, any>> = FunctionTool<TContext, typeof AgentAsToolNeedApprovalSchame> & {
    on: (name: AgentToolEventName, handler: AgentToolEventHandler<TAgent>) => AgentTool<TContext, TAgent>;
};
export declare function saveAgentToolRunResult(toolCall: protocol.FunctionCallItem | undefined, runResult: AnyAgentRunResult): void;
export declare function consumeAgentToolRunResult(toolCall: protocol.FunctionCallItem): AnyAgentRunResult | undefined;
export type ToolUseBehaviorFlags = 'run_llm_again' | 'stop_on_first_tool';
export type ToolsToFinalOutputResult = {
    /**
     * Whether this is the final output. If `false`, the LLM will run again and receive the tool call output
     */
    isFinalOutput: false;
    /**
     * Whether the agent was interrupted by a tool approval. If `true`, the LLM will run again and receive the tool call output
     */
    isInterrupted: undefined;
} | {
    isFinalOutput: false;
    /**
     * Whether the agent was interrupted by a tool approval. If `true`, the LLM will run again and receive the tool call output
     */
    isInterrupted: true;
    interruptions: RunToolApprovalItem[];
} | {
    /**
     * Whether this is the final output. If `false`, the LLM will run again and receive the tool call output
     */
    isFinalOutput: true;
    /**
     * Whether the agent was interrupted by a tool approval. If `true`, the LLM will run again and receive the tool call output
     */
    isInterrupted: undefined;
    /**
     * The final output. Can be undefined if `isFinalOutput` is `false`, otherwise it must be a string
     * that will be processed based on the `outputType` of the agent.
     */
    finalOutput: string;
};
/**
 * The type of the output object. If not provided, the output will be a string.
 * 'text' is a special type that indicates the output will be a string.
 *
 * @template HandoffOutputType The type of the output of the handoff.
 */
export type AgentOutputType<HandoffOutputType = UnknownContext> = TextOutput | ZodObjectLike | JsonSchemaDefinition | HandoffsOutput<HandoffOutputType>;
/**
 * A function that takes a run context and a list of tool results and returns a `ToolsToFinalOutputResult`.
 */
export type ToolToFinalOutputFunction = (context: RunContext, toolResults: FunctionToolResult[]) => ToolsToFinalOutputResult | Promise<ToolsToFinalOutputResult>;
/**
 * The behavior of the agent when a tool is called.
 */
export type ToolUseBehavior = ToolUseBehaviorFlags | {
    /**
     * List of tool names that will stop the agent from running further. The final output will be
     * the output of the first tool in the list that was called.
     */
    stopAtToolNames: string[];
} | ToolToFinalOutputFunction;
/**
 * Configuration for an agent.
 *
 * @template TContext The type of the context object.
 * @template TOutput The type of the output object.
 */
export interface AgentConfiguration<TContext = UnknownContext, TOutput extends AgentOutputType = TextOutput> {
    name: string;
    /**
     * The instructions for the agent. Will be used as the "system prompt" when this agent is
     * invoked. Describes what the agent should do, and how it responds.
     *
     * Can either be a string, or a function that dynamically generates instructions for the agent.
     * If you provide a function, it will be called with the context and the agent instance. It
     * must return a string.
     */
    instructions: string | ((runContext: RunContext<TContext>, agent: Agent<TContext, TOutput>) => Promise<string> | string);
    /**
     * The prompt template to use for the agent (OpenAI Responses API only).
     *
     * Can either be a prompt template object, or a function that returns a prompt
     * template object. If a function is provided, it will be called with the run
     * context and the agent instance. It must return a prompt template object.
     */
    prompt?: Prompt | ((runContext: RunContext<TContext>, agent: Agent<TContext, TOutput>) => Promise<Prompt> | Prompt);
    /**
     * A description of the agent. This is used when the agent is used as a handoff, so that an LLM
     * knows what it does and when to invoke it.
     */
    handoffDescription: string;
    /**
     * Handoffs are sub-agents that the agent can delegate to. You can provide a list of handoffs,
     * and the agent can choose to delegate to them if relevant. Allows for separation of concerns
     * and modularity.
     */
    handoffs: (Agent<any, any> | Handoff<any, TOutput>)[];
    /**
     * The warning log would be enabled when multiple output types by handoff agents are detected.
     */
    handoffOutputTypeWarningEnabled?: boolean;
    /**
     * The model implementation to use when invoking the LLM.
     *
     * By default, if not set, the agent will use the default model returned by
     * getDefaultModel (currently "gpt-4.1").
     */
    model: string | Model;
    /**
     * Configures model-specific tuning parameters (e.g. temperature, top_p, etc.)
     */
    modelSettings: ModelSettings;
    /**
     * A list of tools the agent can use.
     */
    tools: Tool<TContext>[];
    /**
     * A list of [Model Context Protocol](https://modelcontextprotocol.io/) servers the agent can use.
     * Every time the agent runs, it will include tools from these servers in the list of available
     * tools.
     *
     * NOTE: You are expected to manage the lifecycle of these servers. Specifically, you must call
     * `server.connect()` before passing it to the agent, and `server.cleanup()` when the server is
     * no longer needed.
     */
    mcpServers: MCPServer[];
    /**
     * A list of checks that run in parallel to the agent by default; set `runInParallel` to false to
     * block LLM/tool calls until the guardrail completes. Runs only if the agent is the first agent
     * in the chain.
     */
    inputGuardrails: InputGuardrail[];
    /**
     * A list of checks that run on the final output of the agent, after generating a response. Runs
     * only if the agent produces a final output.
     */
    outputGuardrails: OutputGuardrail<TOutput>[];
    /**
     * The type of the output object. If not provided, the output will be a string.
     */
    outputType: TOutput;
    /**
     * This lets you configure how tool use is handled.
     * - run_llm_again: The default behavior. Tools are run, and then the LLM receives the results
     *   and gets to respond.
     * - stop_on_first_tool: The output of the first tool call is used as the final output. This means
     *   that the LLM does not process the result of the tool call.
     * - A list of tool names: The agent will stop running if any of the tools in the list are called.
     *   The final output will be the output of the first matching tool call. The LLM does not process
     *   the result of the tool call.
     * - A function: if you pass a function, it will be called with the run context and the list of
     *   tool results. It must return a `ToolsToFinalOutputResult`, which determines whether the tool
     *   call resulted in a final output.
     *
     * NOTE: This configuration is specific to `FunctionTools`. Hosted tools, such as file search, web
     * search, etc. are always processed by the LLM
     */
    toolUseBehavior: ToolUseBehavior;
    /**
     * Whether to reset the tool choice to the default value after a tool has been called. Defaults
     * to `true`. This ensures that the agent doesn't enter an infinite loop of tool usage.
     */
    resetToolChoice: boolean;
}
export type AgentOptions<TContext = UnknownContext, TOutput extends AgentOutputType = TextOutput> = Expand<Pick<AgentConfiguration<TContext, TOutput>, 'name'> & Partial<AgentConfiguration<TContext, TOutput>>>;
/**
 * An agent is an AI model configured with instructions, tools, guardrails, handoffs and more.
 *
 * We strongly recommend passing `instructions`, which is the "system prompt" for the agent. In
 * addition, you can pass `handoffDescription`, which is a human-readable description of the
 * agent, used when the agent is used inside tools/handoffs.
 *
 * Agents are generic on the context type. The context is a (mutable) object you create. It is
 * passed to tool functions, handoffs, guardrails, etc.
 */
type ExtractAgentOutput<T> = T extends Agent<any, infer O> ? O : never;
type ExtractHandoffOutput<T> = T extends Handoff<any, infer O> ? O : never;
export type HandoffsOutputUnion<Handoffs extends readonly (Agent<any, any> | Handoff<any, any>)[]> = ExtractAgentOutput<Handoffs[number]> | ExtractHandoffOutput<Handoffs[number]>;
/**
 * Helper type for config with handoffs
 *
 * @template TOutput The type of the output object.
 * @template Handoffs The type of the handoffs.
 */
export type AgentConfigWithHandoffs<TOutput extends AgentOutputType, Handoffs extends readonly (Agent<any, any> | Handoff<any, any>)[]> = {
    name: string;
    handoffs?: Handoffs;
    outputType?: TOutput;
} & Partial<Omit<AgentConfiguration<UnknownContext, TOutput | HandoffsOutputUnion<Handoffs>>, 'name' | 'handoffs' | 'outputType'>>;
declare const AgentAsToolNeedApprovalSchame: z.ZodObject<{
    input: z.ZodString;
}, "strip", z.ZodTypeAny, {
    input: string;
}, {
    input: string;
}>;
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
export declare class Agent<TContext = UnknownContext, TOutput extends AgentOutputType = TextOutput> extends AgentHooks<TContext, TOutput> implements AgentConfiguration<TContext, TOutput> {
    /**
     * Create an Agent with handoffs and automatically infer the union type for TOutput from the handoff agents' output types.
     */
    static create<TOutput extends AgentOutputType = TextOutput, Handoffs extends readonly (Agent<any, any> | Handoff<any, any>)[] = []>(config: AgentConfigWithHandoffs<TOutput, Handoffs>): Agent<UnknownContext, TOutput | HandoffsOutputUnion<Handoffs>>;
    static DEFAULT_MODEL_PLACEHOLDER: string;
    name: string;
    instructions: string | ((runContext: RunContext<TContext>, agent: Agent<TContext, TOutput>) => Promise<string> | string);
    prompt?: Prompt | ((runContext: RunContext<TContext>, agent: Agent<TContext, TOutput>) => Promise<Prompt> | Prompt);
    handoffDescription: string;
    handoffs: (Agent<any, TOutput> | Handoff<any, TOutput>)[];
    model: string | Model;
    modelSettings: ModelSettings;
    tools: Tool<TContext>[];
    mcpServers: MCPServer[];
    inputGuardrails: InputGuardrail[];
    outputGuardrails: OutputGuardrail<AgentOutputType>[];
    outputType: TOutput;
    toolUseBehavior: ToolUseBehavior;
    resetToolChoice: boolean;
    private readonly _toolsExplicitlyConfigured;
    constructor(config: AgentOptions<TContext, TOutput>);
    /**
     * Output schema name.
     */
    get outputSchemaName(): string;
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
    clone(config: Partial<AgentConfiguration<TContext, TOutput>>): Agent<TContext, TOutput>;
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
    asTool<TAgent extends Agent<TContext, TOutput> = Agent<TContext, TOutput>>(this: TAgent, options: {
        /**
         * The name of the tool. If not provided, the name of the agent will be used.
         */
        toolName?: string;
        /**
         * The description of the tool, which should indicate what the tool does and when to use it.
         */
        toolDescription?: string;
        /**
         * A function that extracts the output text from the agent. If not provided, the last message
         * from the agent will be used.
         */
        customOutputExtractor?: (output: CompletedRunResult<TContext, TAgent>) => string | Promise<string>;
        /**
         * Whether invoking this tool requires approval, matching the behavior of {@link tool} helpers.
         * When provided as a function it receives the tool arguments and can implement custom approval
         * logic.
         */
        needsApproval?: boolean | ToolApprovalFunction<typeof AgentAsToolNeedApprovalSchame>;
        /**
         * Run configuration for initializing the internal agent runner.
         */
        runConfig?: Partial<RunConfig>;
        /**
         * Additional run options for the agent (as tool) execution.
         */
        runOptions?: AgentToolRunOptions<TContext>;
        /**
         * Determines whether this tool should be exposed to the model for the current run.
         */
        isEnabled?: boolean | ((args: {
            runContext: RunContext<TContext>;
            agent: Agent<TContext, TOutput>;
        }) => boolean | Promise<boolean>);
        /**
         * Optional hook to receive streamed events from the nested agent run.
         */
        onStream?: (event: AgentToolStreamEvent<TAgent>) => void | Promise<void>;
    }): AgentTool<TContext, TAgent>;
    /**
     * Returns the system prompt for the agent.
     *
     * If the agent has a function as its instructions, this function will be called with the
     * runContext and the agent instance.
     */
    getSystemPrompt(runContext: RunContext<TContext>): Promise<string | undefined>;
    /**
     * Returns the prompt template for the agent, if defined.
     *
     * If the agent has a function as its prompt, this function will be called with the
     * runContext and the agent instance.
     */
    getPrompt(runContext: RunContext<TContext>): Promise<Prompt | undefined>;
    /**
     * Fetches the available tools from the MCP servers.
     * @returns the MCP powered tools
     */
    getMcpTools(runContext: RunContext<TContext>): Promise<Tool<TContext>[]>;
    /**
     * ALl agent tools, including the MCPl and function tools.
     *
     * @returns all configured tools
     */
    getAllTools(runContext: RunContext<TContext>): Promise<Tool<TContext>[]>;
    hasExplicitToolConfig(): boolean;
    /**
     * Returns the handoffs that should be exposed to the model for the current run.
     *
     * Handoffs that provide an `isEnabled` function returning `false` are omitted.
     */
    getEnabledHandoffs(runContext: RunContext<TContext>): Promise<Handoff<any, any>[]>;
    /**
     * Processes the final output of the agent.
     *
     * @param output - The output of the agent.
     * @returns The parsed out.
     */
    processFinalOutput(output: string): ResolvedAgentOutput<TOutput>;
    /**
     * Returns a JSON representation of the agent, which is serializable.
     *
     * @returns A JSON object containing the agent's name.
     */
    toJSON(): {
        name: string;
    };
}
export {};
