"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.OpenAIResponsesModel = void 0;
exports.getToolChoice = getToolChoice;
exports.converTool = converTool;
exports.getInputItems = getInputItems;
exports.convertToOutputItem = convertToOutputItem;
const agents_core_1 = require("@openai/agents-core");
const logger_1 = __importDefault(require("./logger.js"));
const zod_1 = require("zod");
const defaults_1 = require("./defaults.js");
const tools_1 = require("./tools.js");
const providerData_1 = require("./utils/providerData.js");
const utils_1 = require("@openai/agents-core/utils");
const HostedToolChoice = zod_1.z.enum([
    'file_search',
    'web_search',
    'web_search_preview',
    'code_interpreter',
    'image_generation',
    'mcp',
    // Specialized local tools
    'computer_use_preview',
    'shell',
    'apply_patch',
]);
const DefaultToolChoice = zod_1.z.enum(['auto', 'required', 'none']);
function getToolChoice(toolChoice) {
    if (typeof toolChoice === 'undefined') {
        return undefined;
    }
    const resultDefaultCheck = DefaultToolChoice.safeParse(toolChoice);
    if (resultDefaultCheck.success) {
        return resultDefaultCheck.data;
    }
    const result = HostedToolChoice.safeParse(toolChoice);
    if (result.success) {
        return { type: result.data };
    }
    return { type: 'function', name: toolChoice };
}
function getResponseFormat(outputType, otherProperties) {
    if (outputType === 'text') {
        return otherProperties;
    }
    return {
        ...otherProperties,
        format: outputType,
    };
}
function normalizeFunctionCallOutputForRequest(output) {
    if (typeof output === 'string') {
        return output;
    }
    if (Array.isArray(output)) {
        return output.map(convertStructuredOutputToRequestItem);
    }
    if (isRecord(output) && typeof output.type === 'string') {
        if (output.type === 'text' && typeof output.text === 'string') {
            return output.text;
        }
        if (output.type === 'image' || output.type === 'file') {
            const structuredItems = convertLegacyToolOutputContent(output);
            return structuredItems.map(convertStructuredOutputToRequestItem);
        }
    }
    return String(output);
}
/**
 * Older tool integrations (and the Python SDK) still return their own `ToolOutput*` objects.
 * Translate those into the protocol `input_*` structures so the rest of the pipeline can stay
 * agnostic about who produced the data.
 */
function convertLegacyToolOutputContent(output) {
    if (output.type === 'text') {
        const structured = {
            type: 'input_text',
            text: output.text,
        };
        if (output.providerData) {
            structured.providerData = output.providerData;
        }
        return [structured];
    }
    if (output.type === 'image') {
        const structured = {
            type: 'input_image',
        };
        if (output.detail) {
            structured.detail = output.detail;
        }
        const legacyImageUrl = output.imageUrl;
        const legacyFileId = output.fileId;
        const dataValue = output.data;
        if (typeof output.image === 'string' && output.image.length > 0) {
            structured.image = output.image;
        }
        else if (isRecord(output.image)) {
            const imageObj = output.image;
            const inlineMediaType = getImageInlineMediaType(imageObj);
            if (typeof imageObj.url === 'string' && imageObj.url.length > 0) {
                structured.image = imageObj.url;
            }
            else if (typeof imageObj.data === 'string' &&
                imageObj.data.length > 0) {
                structured.image = formatInlineData(imageObj.data, inlineMediaType);
            }
            else if (imageObj.data instanceof Uint8Array &&
                imageObj.data.length > 0) {
                structured.image = formatInlineData(imageObj.data, inlineMediaType);
            }
            else {
                const referencedId = (typeof imageObj.fileId === 'string' &&
                    imageObj.fileId.length > 0 &&
                    imageObj.fileId) ||
                    (typeof imageObj.id === 'string' && imageObj.id.length > 0
                        ? imageObj.id
                        : undefined);
                if (referencedId) {
                    structured.image = { id: referencedId };
                }
            }
        }
        else if (typeof legacyImageUrl === 'string' &&
            legacyImageUrl.length > 0) {
            structured.image = legacyImageUrl;
        }
        else if (typeof legacyFileId === 'string' && legacyFileId.length > 0) {
            structured.image = { id: legacyFileId };
        }
        else {
            let base64Data;
            if (typeof dataValue === 'string' && dataValue.length > 0) {
                base64Data = dataValue;
            }
            else if (dataValue instanceof Uint8Array && dataValue.length > 0) {
                base64Data = (0, utils_1.encodeUint8ArrayToBase64)(dataValue);
            }
            if (base64Data) {
                structured.image = base64Data;
            }
        }
        if (output.providerData) {
            structured.providerData = output.providerData;
        }
        return [structured];
    }
    if (output.type === 'file') {
        const structured = {
            type: 'input_file',
        };
        const fileValue = output.file ?? output.file;
        if (typeof fileValue === 'string') {
            structured.file = fileValue;
        }
        else if (isRecord(fileValue)) {
            if (typeof fileValue.data === 'string' && fileValue.data.length > 0) {
                structured.file = formatInlineData(fileValue.data, fileValue.mediaType ?? 'text/plain');
            }
            else if (fileValue.data instanceof Uint8Array &&
                fileValue.data.length > 0) {
                structured.file = formatInlineData(fileValue.data, fileValue.mediaType ?? 'text/plain');
            }
            else if (typeof fileValue.url === 'string' &&
                fileValue.url.length > 0) {
                structured.file = { url: fileValue.url };
            }
            else {
                const referencedId = (typeof fileValue.id === 'string' &&
                    fileValue.id.length > 0 &&
                    fileValue.id) ||
                    (typeof fileValue.fileId === 'string' &&
                        fileValue.fileId.length > 0
                        ? fileValue.fileId
                        : undefined);
                if (referencedId) {
                    structured.file = { id: referencedId };
                }
            }
            if (typeof fileValue.filename === 'string' &&
                fileValue.filename.length > 0) {
                structured.filename = fileValue.filename;
            }
        }
        if (!structured.file) {
            const legacy = normalizeLegacyFileFromOutput(output);
            if (legacy.file) {
                structured.file = legacy.file;
            }
            if (legacy.filename) {
                structured.filename = legacy.filename;
            }
        }
        if (output.providerData) {
            structured.providerData = output.providerData;
        }
        return [structured];
    }
    throw new agents_core_1.UserError(`Unsupported tool output type: ${JSON.stringify(output)}`);
}
/**
 * Converts the protocol-level structured output into the exact wire format expected by the
 * Responses API. Be careful to keep the snake_case property names the service requires here.
 */
function convertStructuredOutputToRequestItem(item) {
    if (item.type === 'input_text') {
        return {
            type: 'input_text',
            text: item.text,
        };
    }
    if (item.type === 'input_image') {
        const result = { type: 'input_image' };
        const imageValue = item.image ?? item.imageUrl;
        if (typeof imageValue === 'string') {
            result.image_url = imageValue;
        }
        else if (isRecord(imageValue) && typeof imageValue.id === 'string') {
            result.file_id = imageValue.id;
        }
        const legacyFileId = item.fileId;
        if (typeof legacyFileId === 'string') {
            result.file_id = legacyFileId;
        }
        if (item.detail) {
            result.detail = item.detail;
        }
        return result;
    }
    if (item.type === 'input_file') {
        const result = { type: 'input_file' };
        if (typeof item.file === 'string') {
            // String file values are treated as inline data or URLs; use { id: "file_..." } for OpenAI file IDs.
            const value = item.file.trim();
            if (value.startsWith('data:')) {
                result.file_data = value;
            }
            else if (value.startsWith('http://') || value.startsWith('https://')) {
                result.file_url = value;
            }
            else if (/^[A-Za-z0-9+/=]+$/.test(value)) {
                result.file_data = value;
            }
            else {
                result.file_url = value;
            }
        }
        else if (item.file &&
            typeof item.file === 'object' &&
            'id' in item.file &&
            typeof item.file.id === 'string') {
            result.file_id = item.file.id;
        }
        else if (item.file &&
            typeof item.file === 'object' &&
            'url' in item.file &&
            typeof item.file.url === 'string') {
            result.file_url = item.file.url;
        }
        const legacyFileData = item.fileData;
        if (typeof legacyFileData === 'string') {
            result.file_data = legacyFileData;
        }
        const legacyFileUrl = item.fileUrl;
        if (typeof legacyFileUrl === 'string') {
            result.file_url = legacyFileUrl;
        }
        const legacyFileId = item.fileId;
        if (typeof legacyFileId === 'string') {
            result.file_id = legacyFileId;
        }
        if (item.filename) {
            result.filename = item.filename;
        }
        return result;
    }
    throw new agents_core_1.UserError(`Unsupported structured tool output: ${JSON.stringify(item)}`);
}
function convertResponseFunctionCallOutputItemToStructured(item) {
    if (item.type === 'input_text') {
        return {
            type: 'input_text',
            text: item.text,
        };
    }
    if (item.type === 'input_image') {
        const structured = { type: 'input_image' };
        if (typeof item.image_url === 'string' && item.image_url.length > 0) {
            structured.image = item.image_url;
        }
        else if (typeof item.file_id === 'string' && item.file_id.length > 0) {
            structured.image = { id: item.file_id };
        }
        else {
            // As of 2025-10-30, conversations retrieval API may not include
            // data url in image_url property; so skipping this pattern
            logger_1.default.debug(`Skipped the "input_image" output item from a tool call result because the OpenAI Conversations API response didn't include the required property (image_url or file_id).`);
            return null;
        }
        if (item.detail) {
            structured.detail = item.detail;
        }
        return structured;
    }
    if (item.type === 'input_file') {
        const structured = { type: 'input_file' };
        if (typeof item.file_id === 'string' && item.file_id.length > 0) {
            structured.file = { id: item.file_id };
        }
        else if (typeof item.file_url === 'string' && item.file_url.length > 0) {
            structured.file = { url: item.file_url };
        }
        else if (typeof item.file_data === 'string' &&
            item.file_data.length > 0) {
            structured.file = item.file_data;
        }
        if (item.filename) {
            structured.filename = item.filename;
        }
        return structured;
    }
    const exhaustive = item;
    throw new agents_core_1.UserError(`Unsupported structured tool output: ${JSON.stringify(exhaustive)}`);
}
function convertFunctionCallOutputToProtocol(output) {
    if (typeof output === 'string') {
        return output;
    }
    if (Array.isArray(output)) {
        return output
            .map(convertResponseFunctionCallOutputItemToStructured)
            .filter((s) => s !== null);
    }
    return '';
}
function normalizeLegacyFileFromOutput(value) {
    const filename = typeof value.filename === 'string' && value.filename.length > 0
        ? value.filename
        : undefined;
    const referencedId = (typeof value.id === 'string' && value.id.length > 0 && value.id) ??
        (typeof value.fileId === 'string' && value.fileId.length > 0
            ? value.fileId
            : undefined);
    if (referencedId) {
        return { file: { id: referencedId }, filename };
    }
    if (typeof value.fileUrl === 'string' && value.fileUrl.length > 0) {
        return { file: { url: value.fileUrl }, filename };
    }
    if (typeof value.fileData === 'string' && value.fileData.length > 0) {
        return {
            file: formatInlineData(value.fileData, value.mediaType ?? 'text/plain'),
            filename,
        };
    }
    if (value.fileData instanceof Uint8Array && value.fileData.length > 0) {
        return {
            file: formatInlineData(value.fileData, value.mediaType ?? 'text/plain'),
            filename,
        };
    }
    return {};
}
function isRecord(value) {
    return typeof value === 'object' && value !== null;
}
function getImageInlineMediaType(source) {
    if (typeof source.mediaType === 'string' && source.mediaType.length > 0) {
        return source.mediaType;
    }
    return undefined;
}
function formatInlineData(data, mediaType) {
    const base64 = typeof data === 'string' ? data : (0, utils_1.encodeUint8ArrayToBase64)(data);
    return mediaType ? `data:${mediaType};base64,${base64}` : base64;
}
function getTools(tools, handoffs) {
    const openaiTools = [];
    const include = [];
    for (const tool of tools) {
        const { tool: openaiTool, include: openaiIncludes } = converTool(tool);
        openaiTools.push(openaiTool);
        if (openaiIncludes && openaiIncludes.length > 0) {
            for (const item of openaiIncludes) {
                include.push(item);
            }
        }
    }
    return {
        tools: [...openaiTools, ...handoffs.map(getHandoffTool)],
        include,
    };
}
function converTool(tool) {
    if (tool.type === 'function') {
        return {
            tool: {
                type: 'function',
                name: tool.name,
                description: tool.description,
                parameters: tool.parameters,
                strict: tool.strict,
            },
            include: undefined,
        };
    }
    else if (tool.type === 'computer') {
        return {
            tool: {
                type: 'computer_use_preview',
                environment: tool.environment,
                display_width: tool.dimensions[0],
                display_height: tool.dimensions[1],
            },
            include: undefined,
        };
    }
    else if (tool.type === 'shell') {
        return {
            tool: {
                type: 'shell',
            },
            include: undefined,
        };
    }
    else if (tool.type === 'apply_patch') {
        return {
            tool: {
                type: 'apply_patch',
            },
            include: undefined,
        };
    }
    else if (tool.type === 'hosted_tool') {
        if (tool.providerData?.type === 'web_search') {
            return {
                tool: {
                    type: 'web_search',
                    user_location: tool.providerData.user_location,
                    filters: tool.providerData.filters,
                    search_context_size: tool.providerData.search_context_size,
                },
                include: undefined,
            };
        }
        else if (tool.providerData?.type === 'web_search_preview') {
            return {
                tool: {
                    type: 'web_search_preview',
                    user_location: tool.providerData.user_location,
                    search_context_size: tool.providerData.search_context_size,
                },
                include: undefined,
            };
        }
        else if (tool.providerData?.type === 'file_search') {
            return {
                tool: {
                    type: 'file_search',
                    vector_store_ids: tool.providerData.vector_store_ids ||
                        // for backwards compatibility
                        (typeof tool.providerData.vector_store_id === 'string'
                            ? [tool.providerData.vector_store_id]
                            : tool.providerData.vector_store_id),
                    max_num_results: tool.providerData.max_num_results,
                    ranking_options: tool.providerData.ranking_options,
                    filters: tool.providerData.filters,
                },
                include: tool.providerData.include_search_results
                    ? ['file_search_call.results']
                    : undefined,
            };
        }
        else if (tool.providerData?.type === 'code_interpreter') {
            return {
                tool: {
                    type: 'code_interpreter',
                    container: tool.providerData.container,
                },
                include: undefined,
            };
        }
        else if (tool.providerData?.type === 'image_generation') {
            return {
                tool: {
                    type: 'image_generation',
                    background: tool.providerData.background,
                    input_fidelity: tool.providerData.input_fidelity,
                    input_image_mask: tool.providerData.input_image_mask,
                    model: tool.providerData.model,
                    moderation: tool.providerData.moderation,
                    output_compression: tool.providerData.output_compression,
                    output_format: tool.providerData.output_format,
                    partial_images: tool.providerData.partial_images,
                    quality: tool.providerData.quality,
                    size: tool.providerData.size,
                },
                include: undefined,
            };
        }
        else if (tool.providerData?.type === 'mcp') {
            return {
                tool: {
                    type: 'mcp',
                    server_label: tool.providerData.server_label,
                    server_url: tool.providerData.server_url,
                    connector_id: tool.providerData.connector_id,
                    authorization: tool.providerData.authorization,
                    allowed_tools: tool.providerData.allowed_tools,
                    headers: tool.providerData.headers,
                    require_approval: convertMCPRequireApproval(tool.providerData.require_approval),
                },
                include: undefined,
            };
        }
        else if (tool.providerData) {
            return {
                tool: tool.providerData,
                include: undefined,
            };
        }
    }
    throw new Error(`Unsupported tool type: ${JSON.stringify(tool)}`);
}
function convertMCPRequireApproval(requireApproval) {
    if (requireApproval === 'never' || requireApproval === undefined) {
        return 'never';
    }
    if (requireApproval === 'always') {
        return 'always';
    }
    return {
        never: { tool_names: requireApproval.never?.tool_names },
        always: { tool_names: requireApproval.always?.tool_names },
    };
}
function getHandoffTool(handoff) {
    return {
        name: handoff.toolName,
        description: handoff.toolDescription,
        parameters: handoff.inputJsonSchema,
        strict: handoff.strictJsonSchema,
        type: 'function',
    };
}
function getInputMessageContent(entry) {
    if (entry.type === 'input_text') {
        return {
            type: 'input_text',
            text: entry.text,
            ...(0, providerData_1.camelOrSnakeToSnakeCase)(entry.providerData),
        };
    }
    else if (entry.type === 'input_image') {
        const imageEntry = {
            type: 'input_image',
            detail: (entry.detail ?? 'auto'),
        };
        if (typeof entry.image === 'string') {
            imageEntry.image_url = entry.image;
        }
        else if (entry.image && 'id' in entry.image) {
            imageEntry.file_id = entry.image.id;
        }
        else if (typeof entry.imageUrl === 'string') {
            imageEntry.image_url = entry.imageUrl;
        }
        else if (typeof entry.fileId === 'string') {
            imageEntry.file_id = entry.fileId;
        }
        return {
            ...imageEntry,
            ...(0, providerData_1.camelOrSnakeToSnakeCase)(entry.providerData),
        };
    }
    else if (entry.type === 'input_file') {
        const fileEntry = {
            type: 'input_file',
        };
        if (typeof entry.file === 'string') {
            if (entry.file.startsWith('data:')) {
                fileEntry.file_data = entry.file;
            }
            else if (entry.file.startsWith('https://')) {
                fileEntry.file_url = entry.file;
            }
            else {
                throw new agents_core_1.UserError(`Unsupported string data for file input. If you're trying to pass an uploaded file's ID, use an object with the ID property instead.`);
            }
        }
        else if (entry.file &&
            typeof entry.file === 'object' &&
            'id' in entry.file) {
            fileEntry.file_id = entry.file.id;
        }
        else if (entry.file &&
            typeof entry.file === 'object' &&
            'url' in entry.file) {
            fileEntry.file_url = entry.file.url;
        }
        const legacyFileData = entry.fileData;
        if (typeof legacyFileData === 'string') {
            fileEntry.file_data = legacyFileData;
        }
        const legacyFileUrl = entry.fileUrl;
        if (typeof legacyFileUrl === 'string') {
            fileEntry.file_url = legacyFileUrl;
        }
        const legacyFileId = entry.fileId;
        if (typeof legacyFileId === 'string') {
            fileEntry.file_id = legacyFileId;
        }
        if (entry.filename) {
            fileEntry.filename = entry.filename;
        }
        return {
            ...fileEntry,
            ...(0, providerData_1.camelOrSnakeToSnakeCase)(entry.providerData),
        };
    }
    throw new agents_core_1.UserError(`Unsupported input content type: ${JSON.stringify(entry)}`);
}
function getOutputMessageContent(entry) {
    if (entry.type === 'output_text') {
        return {
            type: 'output_text',
            text: entry.text,
            annotations: [],
            ...(0, providerData_1.camelOrSnakeToSnakeCase)(entry.providerData),
        };
    }
    if (entry.type === 'refusal') {
        return {
            type: 'refusal',
            refusal: entry.refusal,
            ...(0, providerData_1.camelOrSnakeToSnakeCase)(entry.providerData),
        };
    }
    throw new agents_core_1.UserError(`Unsupported output content type: ${JSON.stringify(entry)}`);
}
function getMessageItem(item) {
    if (item.role === 'system') {
        return {
            id: item.id,
            role: 'system',
            content: item.content,
            ...(0, providerData_1.camelOrSnakeToSnakeCase)(item.providerData),
        };
    }
    if (item.role === 'user') {
        if (typeof item.content === 'string') {
            return {
                id: item.id,
                role: 'user',
                content: item.content,
                ...(0, providerData_1.camelOrSnakeToSnakeCase)(item.providerData),
            };
        }
        return {
            id: item.id,
            role: 'user',
            content: item.content.map(getInputMessageContent),
            ...(0, providerData_1.camelOrSnakeToSnakeCase)(item.providerData),
        };
    }
    if (item.role === 'assistant') {
        const assistantMessage = {
            type: 'message',
            id: item.id,
            role: 'assistant',
            content: item.content.map(getOutputMessageContent),
            status: item.status,
            ...(0, providerData_1.camelOrSnakeToSnakeCase)(item.providerData),
        };
        return assistantMessage;
    }
    throw new agents_core_1.UserError(`Unsupported item ${JSON.stringify(item)}`);
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
function getPrompt(prompt) {
    if (!prompt) {
        return undefined;
    }
    const transformedVariables = {};
    for (const [key, value] of Object.entries(prompt.variables ?? {})) {
        if (typeof value === 'string') {
            transformedVariables[key] = value;
        }
        else if (typeof value === 'object') {
            transformedVariables[key] = getInputMessageContent(value);
        }
    }
    return {
        id: prompt.promptId,
        version: prompt.version,
        variables: transformedVariables,
    };
}
function getInputItems(input) {
    if (typeof input === 'string') {
        return [
            {
                role: 'user',
                content: input,
            },
        ];
    }
    return input.map((item) => {
        if (isMessageItem(item)) {
            return getMessageItem(item);
        }
        if (item.type === 'function_call') {
            const entry = {
                id: item.id,
                type: 'function_call',
                name: item.name,
                call_id: item.callId,
                arguments: item.arguments,
                status: item.status,
                ...(0, providerData_1.camelOrSnakeToSnakeCase)(item.providerData),
            };
            return entry;
        }
        if (item.type === 'function_call_result') {
            const normalizedOutput = normalizeFunctionCallOutputForRequest(item.output);
            const entry = {
                type: 'function_call_output',
                id: item.id,
                call_id: item.callId,
                output: normalizedOutput,
                status: item.status,
                ...(0, providerData_1.camelOrSnakeToSnakeCase)(item.providerData),
            };
            return entry;
        }
        if (item.type === 'reasoning') {
            const entry = {
                id: item.id,
                type: 'reasoning',
                summary: item.content.map((content) => ({
                    type: 'summary_text',
                    text: content.text,
                    ...(0, providerData_1.camelOrSnakeToSnakeCase)(content.providerData),
                })),
                encrypted_content: item.providerData?.encryptedContent,
                ...(0, providerData_1.camelOrSnakeToSnakeCase)(item.providerData),
            };
            return entry;
        }
        if (item.type === 'computer_call') {
            const entry = {
                type: 'computer_call',
                call_id: item.callId,
                id: item.id,
                action: item.action,
                status: item.status,
                pending_safety_checks: [],
                ...(0, providerData_1.camelOrSnakeToSnakeCase)(item.providerData),
            };
            return entry;
        }
        if (item.type === 'computer_call_result') {
            const entry = {
                type: 'computer_call_output',
                id: item.id,
                call_id: item.callId,
                output: buildResponseOutput(item),
                status: item.providerData?.status,
                acknowledged_safety_checks: item.providerData?.acknowledgedSafetyChecks,
                ...(0, providerData_1.camelOrSnakeToSnakeCase)(item.providerData),
            };
            return entry;
        }
        if (item.type === 'shell_call') {
            const action = {
                commands: item.action.commands,
                timeout_ms: typeof item.action.timeoutMs === 'number'
                    ? item.action.timeoutMs
                    : null,
                max_output_length: typeof item.action.maxOutputLength === 'number'
                    ? item.action.maxOutputLength
                    : null,
            };
            const entry = {
                type: 'shell_call',
                id: item.id,
                call_id: item.callId,
                status: item.status ?? 'in_progress',
                action,
            };
            return entry;
        }
        if (item.type === 'shell_call_output') {
            const shellOutputs = item.output;
            const sanitizedOutputs = shellOutputs.map((entry) => {
                const outcome = entry?.outcome;
                const exitCode = outcome?.type === 'exit' ? outcome.exitCode : null;
                return {
                    stdout: typeof entry?.stdout === 'string' ? entry.stdout : '',
                    stderr: typeof entry?.stderr === 'string' ? entry.stderr : '',
                    outcome: outcome?.type === 'timeout'
                        ? { type: 'timeout' }
                        : { type: 'exit', exit_code: exitCode ?? 0 },
                };
            });
            const entry = {
                type: 'shell_call_output',
                call_id: item.callId,
                output: sanitizedOutputs,
                id: item.id ?? undefined,
            };
            if (typeof item.maxOutputLength === 'number') {
                entry.max_output_length = item.maxOutputLength;
            }
            return entry;
        }
        if (item.type === 'apply_patch_call') {
            if (!item.operation) {
                throw new agents_core_1.UserError('apply_patch_call missing operation');
            }
            const entry = {
                type: 'apply_patch_call',
                id: item.id ?? undefined,
                call_id: item.callId,
                status: item.status ?? 'in_progress',
                operation: item.operation,
            };
            return entry;
        }
        if (item.type === 'apply_patch_call_output') {
            const entry = {
                type: 'apply_patch_call_output',
                id: item.id ?? undefined,
                call_id: item.callId,
                status: item.status ?? 'completed',
                output: item.output ?? undefined,
            };
            return entry;
        }
        if (item.type === 'hosted_tool_call') {
            if (item.providerData?.type === 'web_search_call' ||
                item.providerData?.type === 'web_search' // for backward compatibility
            ) {
                const entry = {
                    ...(0, providerData_1.camelOrSnakeToSnakeCase)(item.providerData), // place here to prioritize the below fields
                    type: 'web_search_call',
                    id: item.id,
                    status: tools_1.WebSearchStatus.parse(item.status ?? 'failed'),
                };
                return entry;
            }
            if (item.providerData?.type === 'file_search_call' ||
                item.providerData?.type === 'file_search' // for backward compatibility
            ) {
                const entry = {
                    ...(0, providerData_1.camelOrSnakeToSnakeCase)(item.providerData), // place here to prioritize the below fields
                    type: 'file_search_call',
                    id: item.id,
                    status: tools_1.FileSearchStatus.parse(item.status ?? 'failed'),
                    queries: item.providerData?.queries ?? [],
                    results: item.providerData?.results,
                };
                return entry;
            }
            if (item.providerData?.type === 'code_interpreter_call' ||
                item.providerData?.type === 'code_interpreter' // for backward compatibility
            ) {
                const entry = {
                    ...(0, providerData_1.camelOrSnakeToSnakeCase)(item.providerData), // place here to prioritize the below fields
                    type: 'code_interpreter_call',
                    id: item.id,
                    code: item.providerData?.code ?? '',
                    // This property used to be results, so keeping both for backward compatibility
                    // That said, this property cannot be passed from a user, so it's just API's internal data.
                    outputs: item.providerData?.outputs ?? item.providerData?.results ?? [],
                    status: tools_1.CodeInterpreterStatus.parse(item.status ?? 'failed'),
                    container_id: item.providerData?.container_id,
                };
                return entry;
            }
            if (item.providerData?.type === 'image_generation_call' ||
                item.providerData?.type === 'image_generation' // for backward compatibility
            ) {
                const entry = {
                    ...(0, providerData_1.camelOrSnakeToSnakeCase)(item.providerData), // place here to prioritize the below fields
                    type: 'image_generation_call',
                    id: item.id,
                    result: item.providerData?.result ?? null,
                    status: tools_1.ImageGenerationStatus.parse(item.status ?? 'failed'),
                };
                return entry;
            }
            if (item.providerData?.type === 'mcp_list_tools' ||
                item.name === 'mcp_list_tools') {
                const providerData = item.providerData;
                const entry = {
                    ...(0, providerData_1.camelOrSnakeToSnakeCase)(item.providerData),
                    type: 'mcp_list_tools',
                    id: item.id,
                    tools: (0, providerData_1.camelOrSnakeToSnakeCase)(providerData.tools),
                    server_label: providerData.server_label,
                    error: providerData.error,
                };
                return entry;
            }
            else if (item.providerData?.type === 'mcp_approval_request' ||
                item.name === 'mcp_approval_request') {
                const providerData = item.providerData;
                const entry = {
                    ...(0, providerData_1.camelOrSnakeToSnakeCase)(item.providerData), // place here to prioritize the below fields
                    type: 'mcp_approval_request',
                    id: providerData.id ?? item.id,
                    name: providerData.name,
                    arguments: providerData.arguments,
                    server_label: providerData.server_label,
                };
                return entry;
            }
            else if (item.providerData?.type === 'mcp_approval_response' ||
                item.name === 'mcp_approval_response') {
                const providerData = item.providerData;
                const entry = {
                    ...(0, providerData_1.camelOrSnakeToSnakeCase)(providerData),
                    type: 'mcp_approval_response',
                    id: providerData.id,
                    approve: providerData.approve,
                    approval_request_id: providerData.approval_request_id,
                    reason: providerData.reason,
                };
                return entry;
            }
            else if (item.providerData?.type === 'mcp_call' ||
                item.name === 'mcp_call') {
                const providerData = item.providerData;
                const entry = {
                    // output, which can be a large text string, is optional here, so we don't include it
                    // output: item.output,
                    ...(0, providerData_1.camelOrSnakeToSnakeCase)(providerData), // place here to prioritize the below fields
                    type: 'mcp_call',
                    id: providerData.id ?? item.id,
                    name: providerData.name,
                    arguments: providerData.arguments,
                    server_label: providerData.server_label,
                    error: providerData.error,
                };
                return entry;
            }
            throw new agents_core_1.UserError(`Unsupported built-in tool call type: ${JSON.stringify(item)}`);
        }
        if (item.type === 'compaction') {
            const encryptedContent = item.encrypted_content ?? item.encryptedContent;
            if (typeof encryptedContent !== 'string') {
                throw new agents_core_1.UserError('Compaction item missing encrypted_content');
            }
            return {
                type: 'compaction',
                id: item.id ?? undefined,
                encrypted_content: encryptedContent,
            };
        }
        if (item.type === 'unknown') {
            return {
                ...(0, providerData_1.camelOrSnakeToSnakeCase)(item.providerData), // place here to prioritize the below fields
                id: item.id,
            };
        }
        const exhaustive = item;
        throw new agents_core_1.UserError(`Unsupported item ${JSON.stringify(exhaustive)}`);
    });
}
// As of May 29, the output is always screenshot putput
function buildResponseOutput(item) {
    return {
        type: 'computer_screenshot',
        image_url: item.output.data,
    };
}
function convertToMessageContentItem(item) {
    if (item.type === 'output_text') {
        const { type, text, ...remainingItem } = item;
        return {
            type,
            text,
            ...remainingItem,
        };
    }
    if (item.type === 'refusal') {
        const { type, refusal, ...remainingItem } = item;
        return {
            type,
            refusal,
            ...remainingItem,
        };
    }
    throw new Error(`Unsupported message content type: ${JSON.stringify(item)}`);
}
function convertToOutputItem(items) {
    return items.map((item) => {
        if (item.type === 'message') {
            const { id, type, role, content, status, ...providerData } = item;
            return {
                id,
                type,
                role,
                content: content.map(convertToMessageContentItem),
                status,
                providerData,
            };
        }
        else if (item.type === 'file_search_call' ||
            item.type === 'web_search_call' ||
            item.type === 'image_generation_call' ||
            item.type === 'code_interpreter_call') {
            const { status, ...remainingItem } = item;
            let outputData = undefined;
            if ('result' in remainingItem && remainingItem.result !== null) {
                // type: "image_generation_call"
                outputData = remainingItem.result;
                delete remainingItem.result;
            }
            const output = {
                type: 'hosted_tool_call',
                id: item.id,
                name: item.type,
                status,
                output: outputData,
                providerData: remainingItem,
            };
            return output;
        }
        else if (item.type === 'function_call') {
            const { call_id, name, status, arguments: args, ...providerData } = item;
            const output = {
                type: 'function_call',
                id: item.id,
                callId: call_id,
                name,
                status,
                arguments: args,
                providerData,
            };
            return output;
        }
        else if (item.type === 'function_call_output') {
            const { call_id, status, output: rawOutput, name: toolName, function_name: functionName, ...providerData } = item;
            const output = {
                type: 'function_call_result',
                id: item.id,
                callId: call_id,
                name: toolName ?? functionName ?? call_id,
                status: status ?? 'completed',
                output: convertFunctionCallOutputToProtocol(rawOutput),
                providerData,
            };
            return output;
        }
        else if (item.type === 'computer_call') {
            const { call_id, status, action, ...providerData } = item;
            const output = {
                type: 'computer_call',
                id: item.id,
                callId: call_id,
                status,
                action,
                providerData,
            };
            return output;
        }
        else if (item.type === 'shell_call') {
            const { call_id, status, action, ...providerData } = item;
            const shellAction = {
                commands: Array.isArray(action?.commands) ? action.commands : [],
            };
            const timeout = action?.timeout_ms;
            if (typeof timeout === 'number') {
                shellAction.timeoutMs = timeout;
            }
            const maxOutputLength = action?.max_output_length;
            if (typeof maxOutputLength === 'number') {
                shellAction.maxOutputLength = maxOutputLength;
            }
            const output = {
                type: 'shell_call',
                id: item.id ?? undefined,
                callId: call_id,
                status: status ?? 'in_progress',
                action: shellAction,
                providerData,
            };
            return output;
        }
        else if (item.type === 'shell_call_output') {
            const { call_id, output: responseOutput, max_output_length, ...providerData } = item;
            let normalizedOutput = [];
            if (Array.isArray(responseOutput)) {
                normalizedOutput = responseOutput.map((entry) => ({
                    stdout: typeof entry?.stdout === 'string' ? entry.stdout : '',
                    stderr: typeof entry?.stderr === 'string' ? entry.stderr : '',
                    outcome: entry?.outcome?.type === 'timeout'
                        ? { type: 'timeout' }
                        : {
                            type: 'exit',
                            exitCode: typeof entry?.outcome?.exit_code === 'number'
                                ? entry.outcome.exit_code
                                : null,
                        },
                }));
            }
            const output = {
                type: 'shell_call_output',
                id: item.id ?? undefined,
                callId: call_id,
                output: normalizedOutput,
                providerData,
            };
            if (typeof max_output_length === 'number') {
                output.maxOutputLength = max_output_length;
            }
            return output;
        }
        else if (item.type === 'apply_patch_call') {
            const { call_id, status, operation, ...providerData } = item;
            if (!operation) {
                throw new agents_core_1.UserError('apply_patch_call missing operation');
            }
            let normalizedOperation;
            switch (operation.type) {
                case 'create_file':
                    normalizedOperation = {
                        type: 'create_file',
                        path: operation.path,
                        diff: operation.diff,
                    };
                    break;
                case 'delete_file':
                    normalizedOperation = {
                        type: 'delete_file',
                        path: operation.path,
                    };
                    break;
                case 'update_file':
                    normalizedOperation = {
                        type: 'update_file',
                        path: operation.path,
                        diff: operation.diff,
                    };
                    break;
                default:
                    throw new agents_core_1.UserError('Unknown apply_patch operation type');
            }
            const output = {
                type: 'apply_patch_call',
                id: item.id ?? undefined,
                callId: call_id,
                status: status ?? 'in_progress',
                operation: normalizedOperation,
                providerData,
            };
            return output;
        }
        else if (item.type === 'apply_patch_call_output') {
            const { call_id, status, output: responseOutput, ...providerData } = item;
            const output = {
                type: 'apply_patch_call_output',
                id: item.id ?? undefined,
                callId: call_id,
                status,
                output: typeof responseOutput === 'string' ? responseOutput : undefined,
                providerData,
            };
            return output;
        }
        else if (item.type === 'mcp_list_tools') {
            const { ...providerData } = item;
            const output = {
                type: 'hosted_tool_call',
                id: item.id,
                name: item.type,
                status: 'completed',
                output: undefined,
                providerData,
            };
            return output;
        }
        else if (item.type === 'mcp_approval_request') {
            const { ...providerData } = item;
            const output = {
                type: 'hosted_tool_call',
                id: item.id,
                name: 'mcp_approval_request',
                status: 'completed',
                output: undefined,
                providerData,
            };
            return output;
        }
        else if (item.type === 'mcp_call') {
            // Avoiding to duplicate potentially large output data
            const { output: outputData, ...providerData } = item;
            const output = {
                type: 'hosted_tool_call',
                id: item.id,
                name: item.type,
                status: 'completed',
                output: outputData || undefined,
                providerData,
            };
            return output;
        }
        else if (item.type === 'reasoning') {
            // Avoiding to duplicate potentially large summary data
            const { summary, ...providerData } = item;
            const output = {
                type: 'reasoning',
                id: item.id,
                content: summary.map((content) => {
                    // Avoiding to duplicate potentially large text
                    const { text, ...remainingContent } = content;
                    return {
                        type: 'input_text',
                        text,
                        providerData: remainingContent,
                    };
                }),
                providerData,
            };
            return output;
        }
        else if (item.type === 'compaction') {
            const { encrypted_content, created_by, ...providerData } = item;
            if (typeof encrypted_content !== 'string') {
                throw new agents_core_1.UserError('Compaction item missing encrypted_content');
            }
            const output = {
                type: 'compaction',
                id: item.id ?? undefined,
                encrypted_content,
                created_by,
                providerData,
            };
            return output;
        }
        return {
            type: 'unknown',
            id: item.id,
            providerData: item,
        };
    });
}
/**
 * Model implementation that uses OpenAI's Responses API to generate responses.
 */
class OpenAIResponsesModel {
    #client;
    #model;
    constructor(client, model) {
        this.#client = client;
        this.#model = model;
    }
    async #fetchResponse(request, stream) {
        const input = getInputItems(request.input);
        const { tools, include } = getTools(request.tools, request.handoffs);
        const toolChoice = getToolChoice(request.modelSettings.toolChoice);
        const { text, ...restOfProviderData } = request.modelSettings.providerData ?? {};
        if (request.modelSettings.reasoning) {
            // Merge top-level reasoning settings with provider data
            restOfProviderData.reasoning = {
                ...request.modelSettings.reasoning,
                ...restOfProviderData.reasoning,
            };
        }
        let mergedText = text;
        if (request.modelSettings.text) {
            // Merge top-level text settings with provider data
            mergedText = { ...request.modelSettings.text, ...text };
        }
        const responseFormat = getResponseFormat(request.outputType, mergedText);
        const prompt = getPrompt(request.prompt);
        let parallelToolCalls = undefined;
        if (typeof request.modelSettings.parallelToolCalls === 'boolean') {
            if (request.modelSettings.parallelToolCalls && tools.length === 0) {
                throw new Error('Parallel tool calls are not supported without tools');
            }
            parallelToolCalls = request.modelSettings.parallelToolCalls;
        }
        // When a prompt template already declares a model, skip sending the agent's default model.
        // If the caller explicitly requests an override, include the resolved model name in the request.
        const shouldSendModel = !request.prompt || request.overridePromptModel === true;
        const shouldSendTools = tools.length > 0 ||
            request.toolsExplicitlyProvided === true ||
            !request.prompt;
        const requestData = {
            ...(shouldSendModel ? { model: this.#model } : {}),
            instructions: normalizeInstructions(request.systemInstructions),
            input,
            include,
            ...(shouldSendTools ? { tools } : {}),
            // The Responses API treats `conversation` and `previous_response_id` as mutually exclusive,
            // so we only send `previous_response_id` when no conversation is provided.
            conversation: request.conversationId,
            ...(request.conversationId
                ? {}
                : { previous_response_id: request.previousResponseId }),
            prompt,
            temperature: request.modelSettings.temperature,
            top_p: request.modelSettings.topP,
            truncation: request.modelSettings.truncation,
            max_output_tokens: request.modelSettings.maxTokens,
            tool_choice: toolChoice,
            parallel_tool_calls: parallelToolCalls,
            stream,
            text: responseFormat,
            store: request.modelSettings.store,
            prompt_cache_retention: request.modelSettings.promptCacheRetention,
            ...restOfProviderData,
        };
        if (logger_1.default.dontLogModelData) {
            logger_1.default.debug('Calling LLM');
        }
        else {
            logger_1.default.debug(`Calling LLM. Request data: ${JSON.stringify(requestData, null, 2)}`);
        }
        const response = await this.#client.responses.create(requestData, {
            headers: defaults_1.HEADERS,
            signal: request.signal,
        });
        if (logger_1.default.dontLogModelData) {
            logger_1.default.debug('Response received');
        }
        else {
            logger_1.default.debug(`Response received: ${JSON.stringify(response, null, 2)}`);
        }
        return response;
    }
    /**
     * Get a response from the OpenAI model using the Responses API.
     * @param request - The request to send to the model.
     * @returns A promise that resolves to the response from the model.
     */
    async getResponse(request) {
        const response = await (0, agents_core_1.withResponseSpan)(async (span) => {
            const response = await this.#fetchResponse(request, false);
            if (request.tracing) {
                span.spanData.response_id = response.id;
                span.spanData._input = request.input;
                span.spanData._response = response;
            }
            return response;
        });
        const output = {
            usage: new agents_core_1.Usage({
                inputTokens: response.usage?.input_tokens ?? 0,
                outputTokens: response.usage?.output_tokens ?? 0,
                totalTokens: response.usage?.total_tokens ?? 0,
                inputTokensDetails: { ...response.usage?.input_tokens_details },
                outputTokensDetails: { ...response.usage?.output_tokens_details },
                requestUsageEntries: [
                    toRequestUsageEntry(response.usage, 'responses.create'),
                ],
            }),
            output: convertToOutputItem(response.output),
            responseId: response.id,
            providerData: response,
        };
        return output;
    }
    /**
     * Get a streamed response from the OpenAI model using the Responses API.
     * @param request - The request to send to the model.
     * @returns An async iterable of the response from the model.
     */
    async *getStreamedResponse(request) {
        const span = request.tracing ? (0, agents_core_1.createResponseSpan)() : undefined;
        try {
            if (span) {
                span.start();
                (0, agents_core_1.setCurrentSpan)(span);
                if (request.tracing === true) {
                    span.spanData._input = request.input;
                }
            }
            const response = await this.#fetchResponse(request, true);
            let finalResponse;
            for await (const event of response) {
                if (event.type === 'response.created') {
                    yield {
                        type: 'response_started',
                        providerData: {
                            ...event,
                        },
                    };
                }
                else if (event.type === 'response.completed') {
                    finalResponse = event.response;
                    const { response, ...remainingEvent } = event;
                    const { output, usage, id, ...remainingResponse } = response;
                    yield {
                        type: 'response_done',
                        response: {
                            id: id,
                            output: convertToOutputItem(output),
                            usage: {
                                inputTokens: usage?.input_tokens ?? 0,
                                outputTokens: usage?.output_tokens ?? 0,
                                totalTokens: usage?.total_tokens ?? 0,
                                inputTokensDetails: {
                                    ...usage?.input_tokens_details,
                                },
                                outputTokensDetails: {
                                    ...usage?.output_tokens_details,
                                },
                                requestUsageEntries: [
                                    toRequestUsageEntry(usage, 'responses.create'),
                                ],
                            },
                            providerData: remainingResponse,
                        },
                        providerData: remainingEvent,
                    };
                    yield {
                        type: 'model',
                        event: event,
                    };
                }
                else if (event.type === 'response.output_text.delta') {
                    const { delta, ...remainingEvent } = event;
                    yield {
                        type: 'output_text_delta',
                        delta: delta,
                        providerData: remainingEvent,
                    };
                }
                yield {
                    type: 'model',
                    event: event,
                };
            }
            if (request.tracing && span && finalResponse) {
                span.spanData.response_id = finalResponse.id;
                span.spanData._response = finalResponse;
            }
        }
        catch (error) {
            if (span) {
                span.setError({
                    message: 'Error streaming response',
                    data: {
                        error: request.tracing
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
                (0, agents_core_1.resetCurrentSpan)();
            }
        }
    }
}
exports.OpenAIResponsesModel = OpenAIResponsesModel;
/**
 * Sending an empty string for instructions can override the prompt parameter.
 * Thus, this method checks if the instructions is an empty string and returns undefined if it is.
 * @param instructions - The instructions to normalize.
 * @returns The normalized instructions.
 */
function normalizeInstructions(instructions) {
    if (typeof instructions === 'string') {
        if (instructions.trim() === '') {
            return undefined;
        }
        return instructions;
    }
    return undefined;
}
function toRequestUsageEntry(usage, endpoint) {
    return new agents_core_1.RequestUsage({
        inputTokens: usage?.input_tokens ?? 0,
        outputTokens: usage?.output_tokens ?? 0,
        totalTokens: usage?.total_tokens ?? 0,
        inputTokensDetails: { ...usage?.input_tokens_details },
        outputTokensDetails: { ...usage?.output_tokens_details },
        endpoint,
    });
}
//# sourceMappingURL=openaiResponsesModel.js.map