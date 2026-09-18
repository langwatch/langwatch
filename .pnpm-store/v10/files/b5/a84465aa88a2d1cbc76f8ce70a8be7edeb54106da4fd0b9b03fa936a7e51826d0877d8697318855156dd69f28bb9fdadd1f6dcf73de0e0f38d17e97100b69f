import { Model, protocol } from '@openai/agents-core';
import type { SerializedTool, ModelRequest, ModelResponse, ModelSettingsToolChoice, ResponseStreamEvent } from '@openai/agents-core';
import OpenAI from 'openai';
import { ToolChoiceFunction, ToolChoiceOptions, ToolChoiceTypes } from 'openai/resources/responses/responses';
type ToolChoice = ToolChoiceOptions | ToolChoiceTypes | {
    type: 'web_search';
} | ToolChoiceFunction;
type ResponseOutputItemWithFunctionResult = OpenAI.Responses.ResponseOutputItem | (OpenAI.Responses.ResponseFunctionToolCallOutputItem & {
    name?: string;
    function_name?: string;
});
declare function getToolChoice(toolChoice?: ModelSettingsToolChoice): ToolChoice | undefined;
declare function converTool<_TContext = unknown>(tool: SerializedTool): {
    tool: OpenAI.Responses.Tool;
    include?: OpenAI.Responses.ResponseIncludable[];
};
declare function getInputItems(input: ModelRequest['input']): OpenAI.Responses.ResponseInputItem[];
declare function convertToOutputItem(items: ResponseOutputItemWithFunctionResult[]): protocol.OutputModelItem[];
export { getToolChoice, converTool, getInputItems, convertToOutputItem };
/**
 * Model implementation that uses OpenAI's Responses API to generate responses.
 */
export declare class OpenAIResponsesModel implements Model {
    #private;
    constructor(client: OpenAI, model: string);
    /**
     * Get a response from the OpenAI model using the Responses API.
     * @param request - The request to send to the model.
     * @returns A promise that resolves to the response from the model.
     */
    getResponse(request: ModelRequest): Promise<ModelResponse>;
    /**
     * Get a streamed response from the OpenAI model using the Responses API.
     * @param request - The request to send to the model.
     * @returns An async iterable of the response from the model.
     */
    getStreamedResponse(request: ModelRequest): AsyncIterable<ResponseStreamEvent>;
}
