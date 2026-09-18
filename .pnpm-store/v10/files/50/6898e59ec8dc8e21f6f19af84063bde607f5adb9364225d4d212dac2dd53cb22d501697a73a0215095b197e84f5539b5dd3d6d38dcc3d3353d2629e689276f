var _AbstractChatCompletionRunner_instances, _AbstractChatCompletionRunner_getFinalContent, _AbstractChatCompletionRunner_getFinalMessage, _AbstractChatCompletionRunner_getFinalFunctionToolCall, _AbstractChatCompletionRunner_getFinalFunctionToolCallResult, _AbstractChatCompletionRunner_calculateTotalUsage, _AbstractChatCompletionRunner_validateParams, _AbstractChatCompletionRunner_stringifyFunctionCallResult;
import { __classPrivateFieldGet } from "../internal/tslib.mjs";
import { OpenAIError } from "../error.mjs";
import { uuid4 } from "../internal/utils/uuid.mjs";
import { isAutoParsableTool, parseChatCompletion } from "../lib/parser.mjs";
import { isAssistantMessage, isToolMessage } from "./chatCompletionUtils.mjs";
import { EventStream } from "./EventStream.mjs";
import { isRunnableFunctionWithParse, } from "./RunnableFunction.mjs";
const DEFAULT_MAX_CHAT_COMPLETIONS = 10;
function normalizeToolCallIds(chatCompletion) {
    for (const choice of chatCompletion.choices) {
        for (const toolCall of choice.message.tool_calls ?? []) {
            // Some OpenAI-compatible providers omit tool call IDs or return an empty string.
            // Generate a unique ID before the completion is stored or emitted so the assistant
            // tool call and its result message always reference the same value.
            if (!toolCall.id) {
                toolCall.id = `call_${uuid4()}`;
            }
        }
    }
}
/**
 * Parsed completions contain response-only and helper-only fields. Keep those
 * on runner.messages for callers, but only replay valid request fields.
 */
function toRequestMessage(message) {
    if (!isAssistantMessage(message))
        return message;
    const requestMessage = { role: 'assistant' };
    if (message.audio != null)
        requestMessage.audio = { id: message.audio.id };
    if (message.content !== undefined)
        requestMessage.content = message.content;
    if (message.function_call != null)
        requestMessage.function_call = message.function_call;
    if (message.name !== undefined)
        requestMessage.name = message.name;
    if (message.refusal != null)
        requestMessage.refusal = message.refusal;
    if (message.tool_calls !== undefined) {
        requestMessage.tool_calls = message.tool_calls.map((toolCall) => {
            if (toolCall.type === 'custom') {
                return {
                    id: toolCall.id,
                    type: toolCall.type,
                    custom: {
                        input: toolCall.custom.input,
                        name: toolCall.custom.name,
                    },
                };
            }
            return {
                id: toolCall.id,
                type: toolCall.type,
                function: {
                    arguments: toolCall.function.arguments,
                    name: toolCall.function.name,
                },
            };
        });
    }
    return requestMessage;
}
export class AbstractChatCompletionRunner extends EventStream {
    constructor() {
        super(...arguments);
        _AbstractChatCompletionRunner_instances.add(this);
        this._chatCompletions = [];
        this.messages = [];
    }
    _addChatCompletion(chatCompletion) {
        normalizeToolCallIds(chatCompletion);
        this._chatCompletions.push(chatCompletion);
        this._emit('chatCompletion', chatCompletion);
        const message = chatCompletion.choices[0]?.message;
        if (message)
            this._addMessage(message);
        return chatCompletion;
    }
    _addMessage(message, emit = true) {
        if (!('content' in message))
            message.content = null;
        this.messages.push(message);
        if (emit) {
            this._emit('message', message);
            if (isToolMessage(message) && message.content) {
                // Note, this assumes that {role: 'tool', content: …} is always the result of a call of tool of type=function.
                this._emit('functionToolCallResult', message.content);
            }
            else if (isAssistantMessage(message) && message.tool_calls) {
                for (const tool_call of message.tool_calls) {
                    if (tool_call.type === 'function') {
                        this._emit('functionToolCall', tool_call.function);
                    }
                }
            }
        }
    }
    /**
     * @returns a promise that resolves with the final ChatCompletion, or rejects
     * if an error occurred or the stream ended prematurely without producing a ChatCompletion.
     */
    async finalChatCompletion() {
        await this.done();
        const completion = this._chatCompletions[this._chatCompletions.length - 1];
        if (!completion)
            throw new OpenAIError('stream ended without producing a ChatCompletion');
        return completion;
    }
    /**
     * @returns a promise that resolves with the content of the final ChatCompletionMessage, or rejects
     * if an error occurred or the stream ended prematurely without producing a ChatCompletionMessage.
     */
    async finalContent() {
        await this.done();
        return __classPrivateFieldGet(this, _AbstractChatCompletionRunner_instances, "m", _AbstractChatCompletionRunner_getFinalContent).call(this);
    }
    /**
     * @returns a promise that resolves with the final assistant ChatCompletionMessage response,
     * or rejects if an error occurred or the stream ended prematurely without producing a ChatCompletionMessage.
     */
    async finalMessage() {
        await this.done();
        return __classPrivateFieldGet(this, _AbstractChatCompletionRunner_instances, "m", _AbstractChatCompletionRunner_getFinalMessage).call(this);
    }
    /**
     * @returns a promise that resolves with the content of the final FunctionCall, or rejects
     * if an error occurred or the stream ended prematurely without producing a ChatCompletionMessage.
     */
    async finalFunctionToolCall() {
        await this.done();
        return __classPrivateFieldGet(this, _AbstractChatCompletionRunner_instances, "m", _AbstractChatCompletionRunner_getFinalFunctionToolCall).call(this);
    }
    async finalFunctionToolCallResult() {
        await this.done();
        return __classPrivateFieldGet(this, _AbstractChatCompletionRunner_instances, "m", _AbstractChatCompletionRunner_getFinalFunctionToolCallResult).call(this);
    }
    async totalUsage() {
        await this.done();
        return __classPrivateFieldGet(this, _AbstractChatCompletionRunner_instances, "m", _AbstractChatCompletionRunner_calculateTotalUsage).call(this);
    }
    allChatCompletions() {
        return [...this._chatCompletions];
    }
    _emitFinal() {
        const completion = this._chatCompletions[this._chatCompletions.length - 1];
        if (completion)
            this._emit('finalChatCompletion', completion);
        const finalMessage = __classPrivateFieldGet(this, _AbstractChatCompletionRunner_instances, "m", _AbstractChatCompletionRunner_getFinalMessage).call(this);
        if (finalMessage)
            this._emit('finalMessage', finalMessage);
        const finalContent = __classPrivateFieldGet(this, _AbstractChatCompletionRunner_instances, "m", _AbstractChatCompletionRunner_getFinalContent).call(this);
        if (finalContent)
            this._emit('finalContent', finalContent);
        const finalFunctionCall = __classPrivateFieldGet(this, _AbstractChatCompletionRunner_instances, "m", _AbstractChatCompletionRunner_getFinalFunctionToolCall).call(this);
        if (finalFunctionCall)
            this._emit('finalFunctionToolCall', finalFunctionCall);
        const finalFunctionCallResult = __classPrivateFieldGet(this, _AbstractChatCompletionRunner_instances, "m", _AbstractChatCompletionRunner_getFinalFunctionToolCallResult).call(this);
        if (finalFunctionCallResult != null)
            this._emit('finalFunctionToolCallResult', finalFunctionCallResult);
        if (this._chatCompletions.some((c) => c.usage)) {
            this._emit('totalUsage', __classPrivateFieldGet(this, _AbstractChatCompletionRunner_instances, "m", _AbstractChatCompletionRunner_calculateTotalUsage).call(this));
        }
    }
    async _createChatCompletion(client, params, options) {
        this._listenForAbort(options?.signal);
        __classPrivateFieldGet(this, _AbstractChatCompletionRunner_instances, "m", _AbstractChatCompletionRunner_validateParams).call(this, params);
        const chatCompletion = await client.chat.completions.create({ ...params, stream: false }, { ...options, signal: this.controller.signal });
        this._connected();
        return this._addChatCompletion(parseChatCompletion(chatCompletion, params));
    }
    async _runChatCompletion(client, params, options) {
        for (const message of params.messages) {
            this._addMessage(message, false);
        }
        return await this._createChatCompletion(client, params, options);
    }
    async _runTools(client, params, runner, options) {
        const role = 'tool';
        const { tool_choice = 'auto', stream, toolContext: inputToolContext, ...restParams } = params;
        const toolContext = inputToolContext;
        const singleFunctionToCall = typeof tool_choice !== 'string' && tool_choice.type === 'function' && tool_choice?.function?.name;
        const { maxChatCompletions = DEFAULT_MAX_CHAT_COMPLETIONS, afterCompletion } = options || {};
        // TODO(someday): clean this logic up
        const inputTools = params.tools.map((tool) => {
            if (isAutoParsableTool(tool)) {
                if (!tool.$callback) {
                    throw new OpenAIError('Tool given to `.runTools()` that does not have an associated function');
                }
                return {
                    type: 'function',
                    function: {
                        function: tool.$callback,
                        name: tool.function.name,
                        description: tool.function.description || '',
                        parameters: tool.function.parameters,
                        parse: tool.$parseRaw,
                        strict: true,
                    },
                };
            }
            return tool;
        });
        const functionsByName = {};
        for (const f of inputTools) {
            if (f.type === 'function') {
                functionsByName[f.function.name || f.function.function.name] = f.function;
            }
        }
        const tools = 'tools' in params ?
            inputTools.map((t) => t.type === 'function' ?
                {
                    type: 'function',
                    function: {
                        name: t.function.name || t.function.function.name,
                        parameters: t.function.parameters,
                        description: t.function.description,
                        strict: t.function.strict,
                    },
                }
                : t)
            : undefined;
        for (const message of params.messages) {
            this._addMessage(message, false);
        }
        const runToolCall = async (toolCall) => {
            if (toolCall.type !== 'function')
                return { message: undefined, functionCalled: false };
            const tool_call_id = toolCall.id;
            const { name, arguments: args } = toolCall.function;
            const fn = functionsByName[name];
            if (!fn) {
                const content = `Invalid tool_call: ${JSON.stringify(name)}. Available options are: ${Object.keys(functionsByName)
                    .map((name) => JSON.stringify(name))
                    .join(', ')}. Please try again`;
                return { message: { role, tool_call_id, content }, functionCalled: false };
            }
            if (singleFunctionToCall && singleFunctionToCall !== name) {
                const content = `Invalid tool_call: ${JSON.stringify(name)}. ${JSON.stringify(singleFunctionToCall)} requested. Please try again`;
                return { message: { role, tool_call_id, content }, functionCalled: false };
            }
            let rawContent;
            if (isRunnableFunctionWithParse(fn)) {
                let parsed;
                try {
                    parsed = await fn.parse(args);
                }
                catch (error) {
                    const content = error instanceof Error ? error.message : String(error);
                    return { message: { role, tool_call_id, content }, functionCalled: false };
                }
                rawContent = await fn.function(parsed, runner, toolContext);
            }
            else {
                rawContent = await fn.function(args, runner, toolContext);
            }
            const content = __classPrivateFieldGet(this, _AbstractChatCompletionRunner_instances, "m", _AbstractChatCompletionRunner_stringifyFunctionCallResult).call(this, rawContent);
            return { message: { role, tool_call_id, content }, functionCalled: true };
        };
        for (let i = 0; i < maxChatCompletions; ++i) {
            const chatCompletion = await this._createChatCompletion(client, {
                ...restParams,
                tool_choice,
                tools,
                messages: this.messages.map(toRequestMessage),
            }, options);
            const message = chatCompletion.choices[0]?.message;
            if (!message) {
                throw new OpenAIError(`missing message in ChatCompletion response`);
            }
            if (!message.tool_calls?.length) {
                await afterCompletion?.(chatCompletion, runner);
                return;
            }
            if (singleFunctionToCall || params.parallel_tool_calls === false) {
                for (const toolCall of message.tool_calls) {
                    const result = await runToolCall(toolCall);
                    if (result.message)
                        this._addMessage(result.message);
                    if (singleFunctionToCall && result.functionCalled) {
                        await afterCompletion?.(chatCompletion, runner);
                        return;
                    }
                }
            }
            else {
                const results = await Promise.allSettled(message.tool_calls.map(runToolCall));
                // Wait for every concurrently running tool to settle before surfacing an
                // error so tool side effects cannot continue after the runner has ended.
                for (const result of results) {
                    if (result.status === 'rejected')
                        throw result.reason;
                }
                // Promise.allSettled preserves input order, so the next request receives
                // tool result messages in the same order as the assistant's tool calls.
                for (const result of results) {
                    if (result.status === 'fulfilled' && result.value.message) {
                        this._addMessage(result.value.message);
                    }
                }
            }
            await afterCompletion?.(chatCompletion, runner);
        }
        return;
    }
}
_AbstractChatCompletionRunner_instances = new WeakSet(), _AbstractChatCompletionRunner_getFinalContent = function _AbstractChatCompletionRunner_getFinalContent() {
    return __classPrivateFieldGet(this, _AbstractChatCompletionRunner_instances, "m", _AbstractChatCompletionRunner_getFinalMessage).call(this).content ?? null;
}, _AbstractChatCompletionRunner_getFinalMessage = function _AbstractChatCompletionRunner_getFinalMessage() {
    let i = this.messages.length;
    while (i-- > 0) {
        const message = this.messages[i];
        if (isAssistantMessage(message)) {
            // TODO: support audio here
            const ret = {
                ...message,
                content: message.content ?? null,
                refusal: message.refusal ?? null,
            };
            return ret;
        }
    }
    throw new OpenAIError('stream ended without producing a ChatCompletionMessage with role=assistant');
}, _AbstractChatCompletionRunner_getFinalFunctionToolCall = function _AbstractChatCompletionRunner_getFinalFunctionToolCall() {
    for (let i = this.messages.length - 1; i >= 0; i--) {
        const message = this.messages[i];
        if (isAssistantMessage(message) && message?.tool_calls?.length) {
            for (let j = message.tool_calls.length - 1; j >= 0; j--) {
                const toolCall = message.tool_calls[j];
                if (toolCall?.type === 'function') {
                    return toolCall.function;
                }
            }
        }
    }
    return;
}, _AbstractChatCompletionRunner_getFinalFunctionToolCallResult = function _AbstractChatCompletionRunner_getFinalFunctionToolCallResult() {
    for (let i = this.messages.length - 1; i >= 0; i--) {
        const message = this.messages[i];
        if (isToolMessage(message) &&
            message.content != null &&
            typeof message.content === 'string' &&
            this.messages.some((x) => x.role === 'assistant' &&
                x.tool_calls?.some((y) => y.type === 'function' && y.id === message.tool_call_id))) {
            return message.content;
        }
    }
    return;
}, _AbstractChatCompletionRunner_calculateTotalUsage = function _AbstractChatCompletionRunner_calculateTotalUsage() {
    const total = {
        completion_tokens: 0,
        prompt_tokens: 0,
        total_tokens: 0,
    };
    for (const { usage } of this._chatCompletions) {
        if (usage) {
            total.completion_tokens += usage.completion_tokens;
            total.prompt_tokens += usage.prompt_tokens;
            total.total_tokens += usage.total_tokens;
        }
    }
    return total;
}, _AbstractChatCompletionRunner_validateParams = function _AbstractChatCompletionRunner_validateParams(params) {
    if (params.n != null && params.n > 1) {
        throw new OpenAIError('ChatCompletion convenience helpers only support n=1 at this time. To use n>1, please use chat.completions.create() directly.');
    }
}, _AbstractChatCompletionRunner_stringifyFunctionCallResult = function _AbstractChatCompletionRunner_stringifyFunctionCallResult(rawContent) {
    return (typeof rawContent === 'string' ? rawContent
        : rawContent === undefined ? 'undefined'
            : JSON.stringify(rawContent));
};
//# sourceMappingURL=AbstractChatCompletionRunner.mjs.map