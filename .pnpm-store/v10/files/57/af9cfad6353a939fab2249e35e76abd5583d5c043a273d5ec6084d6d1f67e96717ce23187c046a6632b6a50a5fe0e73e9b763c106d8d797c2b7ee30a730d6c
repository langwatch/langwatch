"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.convertToolChoice = convertToolChoice;
exports.extractAllAssistantContent = extractAllAssistantContent;
exports.extractAllUserContent = extractAllUserContent;
exports.itemsToMessages = itemsToMessages;
exports.toolToOpenAI = toolToOpenAI;
exports.convertHandoffTool = convertHandoffTool;
const agents_core_1 = require("@openai/agents-core");
function convertToolChoice(toolChoice) {
    if (toolChoice == undefined || toolChoice == null)
        return undefined;
    if (toolChoice === 'auto')
        return 'auto';
    if (toolChoice === 'required')
        return 'required';
    if (toolChoice === 'none')
        return 'none';
    return {
        type: 'function',
        function: { name: toolChoice },
    };
}
function extractAllAssistantContent(content) {
    if (typeof content === 'string') {
        return content;
    }
    const out = [];
    for (const c of content) {
        if (c.type === 'output_text') {
            out.push({
                type: 'text',
                text: c.text,
                ...c.providerData,
            });
        }
        else if (c.type === 'refusal') {
            out.push({
                type: 'refusal',
                refusal: c.refusal,
                ...c.providerData,
            });
        }
        else if (c.type === 'audio' || c.type === 'image') {
            // ignoring audio as it is handled on the assistant message level
            continue;
        }
        else {
            const exhaustive = c; // ensures that the type is exhaustive
            throw new Error(`Unknown content: ${JSON.stringify(exhaustive)}`);
        }
    }
    return out;
}
function extractAllUserContent(content) {
    if (typeof content === 'string') {
        return content;
    }
    const out = [];
    for (const c of content) {
        if (c.type === 'input_text') {
            out.push({ type: 'text', text: c.text, ...c.providerData });
        }
        else if (c.type === 'input_image') {
            // The Chat Completions API only accepts image URLs. If we see a file reference we reject it
            // early so callers get an actionable error instead of a cryptic API response.
            const imageSource = typeof c.image === 'string'
                ? c.image
                : typeof c.imageUrl === 'string'
                    ? c.imageUrl
                    : undefined;
            if (!imageSource) {
                throw new Error(`Only image URLs are supported for input_image: ${JSON.stringify(c)}`);
            }
            const { image_url, ...rest } = c.providerData || {};
            out.push({
                type: 'image_url',
                image_url: {
                    url: imageSource,
                    ...image_url,
                },
                ...rest,
            });
        }
        else if (c.type === 'input_file') {
            // Chat Completions API supports file inputs via the "file" content part type.
            // See: https://platform.openai.com/docs/guides/pdf-files?api-mode=chat
            const file = {};
            if (typeof c.file === 'string') {
                const value = c.file.trim();
                if (value.startsWith('data:')) {
                    file.file_data = value;
                }
                else {
                    throw new agents_core_1.UserError(`Chat Completions only supports data URLs for file input. If you're trying to pass an uploaded file's ID, use an object with the id property instead: ${JSON.stringify(c)}`);
                }
            }
            else if (c.file && typeof c.file === 'object' && 'id' in c.file) {
                file.file_id = c.file.id;
            }
            else {
                throw new agents_core_1.UserError(`File input requires a data URL or file ID: ${JSON.stringify(c)}`);
            }
            // Handle filename from the content item or providerData
            if (c.filename) {
                file.filename = c.filename;
            }
            else if (c.providerData?.filename) {
                file.filename = c.providerData.filename;
            }
            const { filename: _filename, ...rest } = c.providerData || {};
            out.push({
                type: 'file',
                file,
                ...rest,
            });
        }
        else if (c.type === 'audio') {
            const { input_audio, ...rest } = c.providerData || {};
            out.push({
                type: 'input_audio',
                input_audio: {
                    data: c.audio,
                    ...input_audio,
                },
                ...rest,
            });
        }
        else {
            const exhaustive = c; // ensures that the type is exhaustive
            throw new Error(`Unknown content: ${JSON.stringify(exhaustive)}`);
        }
    }
    return out;
}
function isMessageItem(item) {
    if (item.type === 'message') {
        return true;
    }
    if (typeof item.type === 'undefined' && typeof item.role === 'string') {
        return true;
    }
    return false;
}
function itemsToMessages(items) {
    if (typeof items === 'string') {
        return [{ role: 'user', content: items }];
    }
    const result = [];
    let currentAssistantMsg = null;
    const flushAssistantMessage = () => {
        if (currentAssistantMsg) {
            if (!currentAssistantMsg.tool_calls ||
                currentAssistantMsg.tool_calls.length === 0) {
                delete currentAssistantMsg.tool_calls;
            }
            result.push(currentAssistantMsg);
            currentAssistantMsg = null;
        }
    };
    const ensureAssistantMessage = () => {
        if (!currentAssistantMsg) {
            currentAssistantMsg = {
                role: 'assistant',
                content: null,
                tool_calls: [],
            };
        }
        return currentAssistantMsg;
    };
    for (const item of items) {
        if (isMessageItem(item)) {
            const { content, role, providerData } = item;
            flushAssistantMessage();
            if (role === 'assistant') {
                const assistant = {
                    role: 'assistant',
                    content: extractAllAssistantContent(content),
                    ...providerData,
                };
                if (Array.isArray(content)) {
                    const audio = content.find((c) => c.type === 'audio');
                    if (audio) {
                        assistant.audio = {
                            id: '', // setting this to empty ID and expecting that the user sets providerData.id
                            ...audio.providerData,
                        };
                    }
                }
                result.push(assistant);
            }
            else if (role === 'user') {
                result.push({
                    role,
                    content: extractAllUserContent(content),
                    ...providerData,
                });
            }
            else if (role === 'system') {
                result.push({
                    role: 'system',
                    content: content,
                    ...providerData,
                });
            }
        }
        else if (item.type === 'reasoning') {
            const asst = ensureAssistantMessage();
            // @ts-expect-error - reasoning is not supported in the official Chat Completion API spec
            // this is handling third party providers that support reasoning
            asst.reasoning = item.rawContent?.[0]?.text;
            continue;
        }
        else if (item.type === 'hosted_tool_call') {
            if (item.name === 'file_search_call') {
                const asst = ensureAssistantMessage();
                const toolCalls = asst.tool_calls ?? [];
                const fileSearch = item;
                const { function: functionData, ...rest } = fileSearch.providerData ?? {};
                const { arguments: argumentData, ...remainingFunctionData } = functionData ?? {};
                toolCalls.push({
                    id: fileSearch.id || '',
                    type: 'function',
                    function: {
                        name: 'file_search_call',
                        arguments: JSON.stringify({
                            queries: fileSearch.providerData?.queries ?? [],
                            status: fileSearch.status,
                            ...argumentData,
                        }),
                        ...remainingFunctionData,
                    },
                    ...rest,
                });
                asst.tool_calls = toolCalls;
                continue;
            }
            else {
                throw new agents_core_1.UserError('Hosted tool calls are not supported for chat completions. Got item: ' +
                    JSON.stringify(item));
            }
        }
        else if (item.type === 'computer_call' ||
            item.type === 'computer_call_result' ||
            item.type === 'shell_call' ||
            item.type === 'shell_call_output' ||
            item.type === 'apply_patch_call' ||
            item.type === 'apply_patch_call_output') {
            throw new agents_core_1.UserError('Computer use calls are not supported for chat completions. Got item: ' +
                JSON.stringify(item));
        }
        else if (item.type === 'function_call') {
            const asst = ensureAssistantMessage();
            const toolCalls = asst.tool_calls ?? [];
            const funcCall = item;
            toolCalls.push({
                id: funcCall.callId,
                type: 'function',
                function: {
                    name: funcCall.name,
                    arguments: funcCall.arguments ?? '{}',
                },
            });
            asst.tool_calls = toolCalls;
            Object.assign(asst, funcCall.providerData);
        }
        else if (item.type === 'function_call_result') {
            flushAssistantMessage();
            const funcOutput = item;
            const toolContent = normalizeFunctionCallOutputForChat(funcOutput.output);
            result.push({
                role: 'tool',
                tool_call_id: funcOutput.callId,
                content: toolContent,
                ...funcOutput.providerData,
            });
        }
        else if (item.type === 'unknown') {
            result.push({
                ...item.providerData,
            });
        }
        else if (item.type === 'compaction') {
            throw new agents_core_1.UserError('Compaction items are not supported for chat completions. Please use the Responses API when working with compaction.');
        }
        else {
            const exhaustive = item; // ensures that the type is exhaustive
            throw new Error(`Unknown item type: ${JSON.stringify(exhaustive)}`);
        }
    }
    flushAssistantMessage();
    return result;
}
function normalizeFunctionCallOutputForChat(output) {
    if (typeof output === 'string') {
        return output;
    }
    if (Array.isArray(output)) {
        const textOnly = output.every((item) => item.type === 'input_text');
        if (!textOnly) {
            throw new agents_core_1.UserError('Only text tool outputs are supported for chat completions.');
        }
        return output.map((item) => item.text).join('');
    }
    if (isRecord(output) &&
        output.type === 'text' &&
        typeof output.text === 'string') {
        return output.text;
    }
    throw new agents_core_1.UserError('Only text tool outputs are supported for chat completions. Got item: ' +
        JSON.stringify(output));
}
function isRecord(value) {
    return typeof value === 'object' && value !== null;
}
function toolToOpenAI(tool) {
    if (tool.type === 'function') {
        return {
            type: 'function',
            function: {
                name: tool.name,
                description: tool.description || '',
                parameters: tool.parameters,
                strict: tool.strict,
            },
        };
    }
    throw new Error(`Hosted tools are not supported with the ChatCompletions API. Got tool type: ${tool.type}, tool: ${JSON.stringify(tool)}`);
}
function convertHandoffTool(handoff) {
    return {
        type: 'function',
        function: {
            name: handoff.toolName,
            description: handoff.toolDescription || '',
            parameters: handoff.inputJsonSchema,
        },
    };
}
//# sourceMappingURL=openaiChatCompletionsConverter.js.map