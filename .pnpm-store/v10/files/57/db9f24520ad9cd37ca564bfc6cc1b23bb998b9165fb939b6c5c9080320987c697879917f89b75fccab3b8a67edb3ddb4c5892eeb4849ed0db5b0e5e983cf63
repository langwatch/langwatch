import { Usage, withGenerationSpan, resetCurrentSpan, createGenerationSpan, setCurrentSpan, } from '@openai/agents-core';
import logger from "./logger.mjs";
import { HEADERS } from "./defaults.mjs";
import { convertChatCompletionsStreamToResponses } from "./openaiChatCompletionsStreaming.mjs";
import { convertToolChoice, toolToOpenAI, convertHandoffTool, itemsToMessages, } from "./openaiChatCompletionsConverter.mjs";
export const FAKE_ID = 'FAKE_ID';
function hasReasoningContent(message) {
    return ('reasoning' in message &&
        typeof message.reasoning === 'string' &&
        message.reasoning !== '');
}
/**
 * A model that uses (or is compatible with) OpenAI's Chat Completions API.
 */
export class OpenAIChatCompletionsModel {
    #client;
    #model;
    constructor(client, model) {
        this.#client = client;
        this.#model = model;
    }
    async getResponse(request) {
        const response = await withGenerationSpan(async (span) => {
            span.spanData.model = this.#model;
            span.spanData.model_config = request.modelSettings
                ? {
                    temperature: request.modelSettings.temperature,
                    top_p: request.modelSettings.topP,
                    frequency_penalty: request.modelSettings.frequencyPenalty,
                    presence_penalty: request.modelSettings.presencePenalty,
                    reasoning_effort: request.modelSettings.reasoning?.effort,
                    verbosity: request.modelSettings.text?.verbosity,
                }
                : { base_url: this.#client.baseURL };
            const response = await this.#fetchResponse(request, span, false);
            if (span && request.tracing === true) {
                span.spanData.output = [response];
            }
            return response;
        });
        const output = [];
        if (response.choices && response.choices[0]) {
            const message = response.choices[0].message;
            if (hasReasoningContent(message)) {
                output.push({
                    type: 'reasoning',
                    content: [],
                    rawContent: [
                        {
                            type: 'reasoning_text',
                            text: message.reasoning,
                        },
                    ],
                });
            }
            const hasContent = message.content !== undefined &&
                message.content !== null &&
                // Azure OpenAI returns empty string instead of null for tool calls, causing parser rejection
                !(message.tool_calls && message.content === '');
            if (hasContent) {
                const { content, ...rest } = message;
                output.push({
                    id: response.id,
                    type: 'message',
                    role: 'assistant',
                    content: [
                        {
                            type: 'output_text',
                            text: content || '',
                            providerData: rest,
                        },
                    ],
                    status: 'completed',
                });
            }
            else if (message.refusal) {
                const { refusal, ...rest } = message;
                output.push({
                    id: response.id,
                    type: 'message',
                    role: 'assistant',
                    content: [
                        {
                            type: 'refusal',
                            refusal: refusal || '',
                            providerData: rest,
                        },
                    ],
                    status: 'completed',
                });
            }
            else if (message.audio) {
                const { data, ...remainingAudioData } = message.audio;
                output.push({
                    id: response.id,
                    type: 'message',
                    role: 'assistant',
                    content: [
                        {
                            type: 'audio',
                            audio: data,
                            providerData: remainingAudioData,
                        },
                    ],
                    status: 'completed',
                });
            }
            if (message.tool_calls) {
                for (const tool_call of message.tool_calls) {
                    if (tool_call.type === 'function') {
                        // Note: custom tools are not supported for now
                        const { id: callId, ...remainingToolCallData } = tool_call;
                        const { arguments: args, name, ...remainingFunctionData } = tool_call.function;
                        output.push({
                            id: response.id,
                            type: 'function_call',
                            arguments: args,
                            name: name,
                            callId: callId,
                            status: 'completed',
                            providerData: {
                                ...remainingToolCallData,
                                ...remainingFunctionData,
                            },
                        });
                    }
                }
            }
        }
        const modelResponse = {
            usage: response.usage
                ? new Usage(toResponseUsage(response.usage))
                : new Usage(),
            output,
            responseId: response.id,
            providerData: response,
        };
        return modelResponse;
    }
    async *getStreamedResponse(request) {
        const span = request.tracing ? createGenerationSpan() : undefined;
        try {
            if (span) {
                span.start();
                setCurrentSpan(span);
            }
            const stream = await this.#fetchResponse(request, span, true);
            const response = {
                id: FAKE_ID,
                created: Math.floor(Date.now() / 1000),
                model: this.#model,
                object: 'chat.completion',
                choices: [],
                usage: {
                    prompt_tokens: 0,
                    completion_tokens: 0,
                    total_tokens: 0,
                },
            };
            for await (const event of convertChatCompletionsStreamToResponses(response, stream)) {
                if (event.type === 'response_done' &&
                    response.usage?.total_tokens === 0) {
                    response.usage = {
                        prompt_tokens: event.response.usage.inputTokens,
                        completion_tokens: event.response.usage.outputTokens,
                        total_tokens: event.response.usage.totalTokens,
                        prompt_tokens_details: Array.isArray(event.response.usage.inputTokensDetails)
                            ? event.response.usage.inputTokensDetails[0]
                            : event.response.usage.inputTokensDetails,
                        completion_tokens_details: Array.isArray(event.response.usage.outputTokensDetails)
                            ? event.response.usage.outputTokensDetails[0]
                            : event.response.usage.outputTokensDetails,
                    };
                }
                yield event;
            }
            if (span && response && request.tracing === true) {
                span.spanData.output = [response];
            }
        }
        catch (error) {
            if (span) {
                span.setError({
                    message: 'Error streaming response',
                    data: {
                        error: request.tracing === true
                            ? String(error)
                            : error instanceof Error
                                ? error.name
                                : undefined,
                    },
                });
            }
            throw error;
        }
        finally {
            if (span) {
                span.end();
                resetCurrentSpan();
            }
        }
    }
    async #fetchResponse(request, span, stream) {
        const tools = [];
        if (request.tools) {
            for (const tool of request.tools) {
                tools.push(toolToOpenAI(tool));
            }
        }
        if (request.handoffs) {
            for (const handoff of request.handoffs) {
                tools.push(convertHandoffTool(handoff));
            }
        }
        const responseFormat = getResponseFormat(request.outputType);
        let parallelToolCalls = undefined;
        if (typeof request.modelSettings.parallelToolCalls === 'boolean') {
            if (request.modelSettings.parallelToolCalls && tools.length === 0) {
                throw new Error('Parallel tool calls are not supported without tools');
            }
            parallelToolCalls = request.modelSettings.parallelToolCalls;
        }
        const messages = itemsToMessages(request.input);
        if (request.systemInstructions) {
            messages.unshift({
                content: request.systemInstructions,
                role: 'system',
            });
        }
        if (span && request.tracing === true) {
            span.spanData.input = messages;
        }
        const providerData = request.modelSettings.providerData ?? {};
        if (request.modelSettings.reasoning &&
            request.modelSettings.reasoning.effort) {
            // merge the top-level reasoning.effort into provider data
            providerData.reasoning_effort = request.modelSettings.reasoning.effort;
        }
        if (request.modelSettings.text && request.modelSettings.text.verbosity) {
            // merge the top-level text.verbosity into provider data
            providerData.verbosity = request.modelSettings.text.verbosity;
        }
        const requestData = {
            model: this.#model,
            messages,
            tools: tools.length ? tools : undefined,
            temperature: request.modelSettings.temperature,
            top_p: request.modelSettings.topP,
            frequency_penalty: request.modelSettings.frequencyPenalty,
            presence_penalty: request.modelSettings.presencePenalty,
            max_tokens: request.modelSettings.maxTokens,
            tool_choice: convertToolChoice(request.modelSettings.toolChoice),
            parallel_tool_calls: parallelToolCalls,
            stream: stream ? true : false,
            stream_options: stream ? { include_usage: true } : undefined,
            store: request.modelSettings.store,
            prompt_cache_retention: request.modelSettings.promptCacheRetention,
            ...providerData,
        };
        if (responseFormat) {
            requestData.response_format = responseFormat;
        }
        if (logger.dontLogModelData) {
            logger.debug('Calling LLM');
        }
        else {
            logger.debug(`Calling LLM. Request data: ${JSON.stringify(requestData, null, 2)}`);
        }
        const completion = await this.#client.chat.completions.create(requestData, {
            headers: HEADERS,
            signal: request.signal,
        });
        if (logger.dontLogModelData) {
            logger.debug('Response received');
        }
        else {
            logger.debug(`Response received: ${JSON.stringify(completion, null, 2)}`);
        }
        return completion;
    }
}
function getResponseFormat(outputType) {
    if (outputType === 'text') {
        // Avoid sending response_format for plain text responses because some Chat Completions
        // compatible providers (e.g., Claude) reject non-json_schema values here. OpenAI's API
        // already treats text as the default when the field is omitted.
        return undefined;
    }
    if (outputType.type === 'json_schema') {
        return {
            type: 'json_schema',
            json_schema: {
                name: outputType.name,
                strict: outputType.strict,
                schema: outputType.schema,
            },
        };
    }
    return { type: 'json_object' };
}
function toResponseUsage(usage) {
    return {
        requests: 1,
        input_tokens: usage.prompt_tokens,
        output_tokens: usage.completion_tokens,
        total_tokens: usage.total_tokens,
        input_tokens_details: {
            cached_tokens: usage.prompt_tokens_details?.cached_tokens || 0,
        },
        output_tokens_details: {
            reasoning_tokens: usage.completion_tokens_details?.reasoning_tokens || 0,
        },
    };
}
//# sourceMappingURL=openaiChatCompletionsModel.mjs.map