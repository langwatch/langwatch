import { Usage } from './usage';
import { StreamEvent } from './types/protocol';
import { HostedTool, ComputerTool, FunctionTool, ShellTool, ApplyPatchTool } from './tool';
import { Computer } from './computer';
import { Handoff } from './handoff';
import { AgentInputItem, AgentOutputItem, JsonSchemaDefinition, TextOutput, InputText, InputImage, InputFile } from './types';
export type ModelSettingsToolChoice = 'auto' | 'required' | 'none' | (string & {});
/**
 * Constrains effort on reasoning for [reasoning models](https://platform.openai.com/docs/guides/reasoning).
 * Currently supported values are `minimal`, `low`, `medium`, and `high`.
 * Reducing reasoning effort can result in faster responses and fewer tokens used on reasoning in a response.
 */
export type ModelSettingsReasoningEffort = 'none' | 'minimal' | 'low' | 'medium' | 'high' | null;
/**
 * Configuration options for [reasoning models](https://platform.openai.com/docs/guides/reasoning).
 */
export type ModelSettingsReasoning = {
    /**
     * Constrains effort on reasoning for [reasoning models](https://platform.openai.com/docs/guides/reasoning).
     * Currently supported values are `minimal`, `low`, `medium`, and `high`.
     * Reducing reasoning effort can result in faster responses and fewer tokens used on reasoning in a response.
     */
    effort?: ModelSettingsReasoningEffort | null;
    /**
     * A summary of the reasoning performed by the model.
     * This can be useful for debugging and understanding the model's reasoning process.
     * One of `auto`, `concise`, or `detailed`.
     */
    summary?: 'auto' | 'concise' | 'detailed' | null;
};
export interface ModelSettingsText {
    /**
     * Constrains the verbosity of the model's response.
     * Lower values will result in more concise responses, while higher values will result in more verbose responses.
     * Currently supported values are `low`, `medium`, and `high`.
     */
    verbosity?: 'low' | 'medium' | 'high' | null;
}
/**
 * Settings to use when calling an LLM.
 *
 * This class holds optional model configuration parameters (e.g. temperature,
 * topP, penalties, truncation, etc.).
 *
 * Not all models/providers support all of these parameters, so please check the API documentation
 * for the specific model and provider you are using.
 */
export type ModelSettings = {
    /**
     * The temperature to use when calling the model.
     */
    temperature?: number;
    /**
     * The topP to use when calling the model.
     */
    topP?: number;
    /**
     * The frequency penalty to use when calling the model.
     */
    frequencyPenalty?: number;
    /**
     * The presence penalty to use when calling the model.
     */
    presencePenalty?: number;
    /**
     * The tool choice to use when calling the model.
     */
    toolChoice?: ModelSettingsToolChoice;
    /**
     * Whether to use parallel tool calls when calling the model.
     * Defaults to false if not provided.
     */
    parallelToolCalls?: boolean;
    /**
     * The truncation strategy to use when calling the model.
     */
    truncation?: 'auto' | 'disabled';
    /**
     * The maximum number of output tokens to generate.
     */
    maxTokens?: number;
    /**
     * Whether to store the generated model response for later retrieval.
     * Defaults to true if not provided.
     */
    store?: boolean;
    /**
     * Enables prompt caching and controls how long cached content should be retained by the model provider.
     * See https://platform.openai.com/docs/guides/prompt-caching#prompt-cache-retention for the available options.
     */
    promptCacheRetention?: 'in-memory' | '24h' | null;
    /**
     * The reasoning settings to use when calling the model.
     */
    reasoning?: ModelSettingsReasoning;
    /**
     * The text settings to use when calling the model.
     */
    text?: ModelSettingsText;
    /**
     * Additional provider specific settings to be passed directly to the model
     * request.
     */
    providerData?: Record<string, any>;
};
export type ModelTracing = boolean | 'enabled_without_data';
export type SerializedFunctionTool = {
    /**
     * The type of the tool.
     */
    type: FunctionTool['type'];
    /**
     * The name of the tool.
     */
    name: FunctionTool['name'];
    /**
     * The description of the tool that helps the model to understand when to use the tool
     */
    description: FunctionTool['description'];
    /**
     * A JSON schema describing the parameters of the tool.
     */
    parameters: FunctionTool['parameters'];
    /**
     * Whether the tool is strict. If true, the model must try to strictly follow the schema
     * (might result in slower response times).
     */
    strict: FunctionTool['strict'];
};
export type SerializedComputerTool = {
    type: ComputerTool['type'];
    name: ComputerTool['name'];
    environment: Computer['environment'];
    dimensions: Computer['dimensions'];
};
export type SerializedShellTool = {
    type: ShellTool['type'];
    name: ShellTool['name'];
};
export type SerializedApplyPatchTool = {
    type: ApplyPatchTool['type'];
    name: ApplyPatchTool['name'];
};
export type SerializedHostedTool = {
    type: HostedTool['type'];
    name: HostedTool['name'];
    providerData?: HostedTool['providerData'];
};
export type SerializedTool = SerializedFunctionTool | SerializedComputerTool | SerializedShellTool | SerializedApplyPatchTool | SerializedHostedTool;
export type SerializedHandoff = {
    /**
     * The name of the tool that represents the handoff.
     */
    toolName: Handoff['toolName'];
    /**
     * The tool description for the handoff
     */
    toolDescription: Handoff['toolDescription'];
    /**
     * The JSON schema for the handoff input. Can be empty if the handoff does not take an input
     */
    inputJsonSchema: Handoff['inputJsonSchema'];
    /**
     * Whether the input JSON schema is in strict mode. We strongly recommend setting this to true,
     * as it increases the likelihood of correct JSON input.
     */
    strictJsonSchema: Handoff['strictJsonSchema'];
};
/**
 * The output type passed to the model. Has any Zod types serialized to JSON Schema
 */
export type SerializedOutputType = JsonSchemaDefinition | TextOutput;
/**
 * A request to a large language model.
 */
export type ModelRequest = {
    /**
     * The system instructions to use for the model.
     */
    systemInstructions?: string;
    /**
     * The input to the model.
     */
    input: string | AgentInputItem[];
    /**
     * The ID of the previous response to use for the model.
     */
    previousResponseId?: string;
    /**
     * The ID of stored conversation to use for the model.
     *
     * see https://platform.openai.com/docs/guides/conversation-state?api-mode=responses#openai-apis-for-conversation-state
     * see https://platform.openai.com/docs/api-reference/conversations/create
     */
    conversationId?: string;
    /**
     * The model settings to use for the model.
     */
    modelSettings: ModelSettings;
    /**
     * The tools to use for the model.
     */
    tools: SerializedTool[];
    /**
     * When true, the caller explicitly configured the tools list (even if empty).
     * Providers can use this to avoid overwriting prompt-defined tools when an agent
     * does not specify its own tools.
     */
    toolsExplicitlyProvided?: boolean;
    /**
     * The type of the output to use for the model.
     */
    outputType: SerializedOutputType;
    /**
     * The handoffs to use for the model.
     */
    handoffs: SerializedHandoff[];
    /**
     * Whether to enable tracing for the model.
     */
    tracing: ModelTracing;
    /**
     * An optional signal to abort the model request.
     */
    signal?: AbortSignal;
    /**
     * The prompt template to use for the model, if any.
     */
    prompt?: Prompt;
    /**
     * When true, the resolved model should override the model configured in the prompt template.
     * Providers that support prompt templates should include the explicit model name in the request
     * even when a prompt is supplied.
     */
    overridePromptModel?: boolean;
};
export type ModelResponse = {
    /**
     * The usage information for response.
     */
    usage: Usage;
    /**
     * A list of outputs (messages, tool calls, etc.) generated by the model.
     */
    output: AgentOutputItem[];
    /**
     * An ID for the response which can be used to refer to the response in subsequent calls to the
     * model. Not supported by all model providers.
     */
    responseId?: string;
    /**
     * Raw response data from the underlying model provider.
     */
    providerData?: Record<string, any>;
};
/**
 * The base interface for calling an LLM.
 */
export interface Model {
    /**
     * Get a response from the model.
     *
     * @param request - The request to get a response for.
     */
    getResponse(request: ModelRequest): Promise<ModelResponse>;
    /**
     * Get a streamed response from the model.
     *
     */
    getStreamedResponse(request: ModelRequest): AsyncIterable<StreamEvent>;
}
/**
 * The base interface for a model provider.
 *
 * The model provider is responsible for looking up `Model` instances by name.
 */
export interface ModelProvider {
    /**
     * Get a model by name
     *
     * @param modelName - The name of the model to get.
     */
    getModel(modelName?: string): Promise<Model> | Model;
}
/**
 * Reference to a prompt template and its variables.
 */
export type Prompt = {
    /**
     * The unique identifier of the prompt template to use.
     */
    promptId: string;
    /**
     * Optional version of the prompt template.
     */
    version?: string;
    /**
     * Optional variables to substitute into the prompt template.
     * Can be a string, or an object with string keys and values that are string,
     * InputText, InputImage, or InputFile.
     */
    variables?: {
        [key: string]: string | InputText | InputImage | InputFile;
    };
};
