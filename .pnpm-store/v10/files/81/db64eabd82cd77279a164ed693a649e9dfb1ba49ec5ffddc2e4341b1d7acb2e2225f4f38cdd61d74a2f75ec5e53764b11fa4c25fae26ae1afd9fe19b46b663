import { FAKE_ID } from "./openaiChatCompletionsModel.mjs";
export async function* convertChatCompletionsStreamToResponses(response, stream) {
    let usage = undefined;
    const state = {
        started: false,
        text_content: null,
        refusal_content: null,
        function_calls: {},
        reasoning: '',
    };
    for await (const chunk of stream) {
        if (!state.started) {
            state.started = true;
            yield {
                type: 'response_started',
                providerData: {
                    ...chunk,
                },
            };
        }
        // always yield the raw event
        yield {
            type: 'model',
            event: chunk,
        };
        // This is always set by the OpenAI API, but not by others e.g. LiteLLM
        usage = chunk.usage || undefined;
        if (!chunk.choices?.[0]?.delta)
            continue;
        const delta = chunk.choices[0].delta;
        // Handle text
        if (delta.content) {
            if (!state.text_content) {
                state.text_content = {
                    text: '',
                    type: 'output_text',
                    providerData: { annotations: [] },
                };
            }
            yield {
                type: 'output_text_delta',
                delta: delta.content,
                providerData: {
                    ...chunk,
                },
            };
            state.text_content.text += delta.content;
        }
        if ('reasoning' in delta &&
            delta.reasoning &&
            typeof delta.reasoning === 'string') {
            state.reasoning += delta.reasoning;
        }
        // Handle refusals
        if ('refusal' in delta && delta.refusal) {
            if (!state.refusal_content) {
                state.refusal_content = { refusal: '', type: 'refusal' };
            }
            state.refusal_content.refusal += delta.refusal;
        }
        // Handle tool calls
        if (delta.tool_calls) {
            for (const tc_delta of delta.tool_calls) {
                if (!(tc_delta.index in state.function_calls)) {
                    state.function_calls[tc_delta.index] = {
                        id: FAKE_ID,
                        arguments: '',
                        name: '',
                        type: 'function_call',
                        callId: '',
                    };
                }
                const tc_function = tc_delta.function;
                state.function_calls[tc_delta.index].arguments +=
                    tc_function?.arguments || '';
                state.function_calls[tc_delta.index].name += tc_function?.name || '';
                state.function_calls[tc_delta.index].callId += tc_delta.id || '';
            }
        }
    }
    // Final output message
    const outputs = [];
    if (state.reasoning) {
        outputs.push({
            type: 'reasoning',
            content: [],
            rawContent: [{ type: 'reasoning_text', text: state.reasoning }],
        });
    }
    if (state.text_content || state.refusal_content) {
        const content = [];
        if (state.text_content) {
            content.push(state.text_content);
        }
        if (state.refusal_content) {
            content.push(state.refusal_content);
        }
        outputs.push({
            id: FAKE_ID,
            content,
            role: 'assistant',
            type: 'message',
            status: 'completed',
        });
    }
    for (const function_call of Object.values(state.function_calls)) {
        // Some providers, such as Bedrock, may send two items:
        // 1) an empty argument, and 2) the actual argument data.
        // This is a workaround for that specific behavior.
        if (function_call.arguments.startsWith('{}{')) {
            function_call.arguments = function_call.arguments.slice(2);
        }
        outputs.push(function_call);
    }
    // Compose final response
    const finalEvent = {
        type: 'response_done',
        response: {
            id: response.id,
            usage: {
                inputTokens: usage?.prompt_tokens ?? 0,
                outputTokens: usage?.completion_tokens ?? 0,
                totalTokens: usage?.total_tokens ?? 0,
                inputTokensDetails: {
                    cached_tokens: usage?.prompt_tokens_details?.cached_tokens ?? 0,
                },
                outputTokensDetails: {
                    reasoning_tokens: usage?.completion_tokens_details?.reasoning_tokens ?? 0,
                },
            },
            output: outputs,
        },
    };
    yield finalEvent;
}
//# sourceMappingURL=openaiChatCompletionsStreaming.mjs.map