"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.StreamEventGenericItem = exports.StreamEventResponseCompleted = exports.StreamEventResponseStarted = exports.StreamEventTextStream = exports.UsageData = exports.RequestUsageData = exports.ModelItem = exports.OutputModelItem = exports.UnknownItem = exports.CompactionItem = exports.ReasoningItem = exports.ToolCallItem = exports.ApplyPatchCallResultItem = exports.ApplyPatchCallItem = exports.ApplyPatchOperation = exports.ApplyPatchOperationDeleteFile = exports.ApplyPatchOperationUpdateFile = exports.ApplyPatchOperationCreateFile = exports.ShellCallResultItem = exports.ShellCallOutputContent = exports.ShellCallOutcome = exports.ShellCallItem = exports.ShellAction = exports.ComputerCallResultItem = exports.ComputerUseCallItem = exports.FunctionCallResultItem = exports.ToolCallStructuredOutput = exports.ToolCallOutputContent = exports.FunctionCallItem = exports.HostedToolCallItem = exports.MessageItem = exports.UserMessageItem = exports.UserContent = exports.AssistantMessageItem = exports.AssistantContent = exports.computerActions = exports.ComputerToolOutput = exports.ToolOutputFileContent = exports.ToolOutputImage = exports.ToolOutputText = exports.ImageContent = exports.AudioContent = exports.InputFile = exports.InputImage = exports.ReasoningText = exports.InputText = exports.OutputText = exports.Refusal = exports.ItemBase = exports.SharedBase = void 0;
exports.StreamEvent = void 0;
const zod_1 = require("zod");
// ----------------------------
// Shared base types
// ----------------------------
/**
 * Every item in the protocol provides a `providerData` field to accommodate custom functionality
 * or new fields
 */
exports.SharedBase = zod_1.z.object({
    /**
     * Additional optional provider specific data. Used for custom functionality or model provider
     * specific fields.
     */
    providerData: zod_1.z.record(zod_1.z.string(), zod_1.z.any()).optional(),
});
/**
 * Every item has a shared of shared item data including an optional ID.
 */
exports.ItemBase = exports.SharedBase.extend({
    /**
     * An ID to identify the item. This is optional by default. If a model provider absolutely
     * requires this field, it will be validated on the model level.
     */
    id: zod_1.z.string().optional(),
});
// ----------------------------
// Content types
// ----------------------------
exports.Refusal = exports.SharedBase.extend({
    type: zod_1.z.literal('refusal'),
    /**
     * The refusal explanation from the model.
     */
    refusal: zod_1.z.string(),
});
exports.OutputText = exports.SharedBase.extend({
    type: zod_1.z.literal('output_text'),
    /**
     * The text output from the model.
     */
    text: zod_1.z.string(),
});
exports.InputText = exports.SharedBase.extend({
    type: zod_1.z.literal('input_text'),
    /**
     * A text input for example a message from a user
     */
    text: zod_1.z.string(),
});
exports.ReasoningText = exports.SharedBase.extend({
    type: zod_1.z.literal('reasoning_text'),
    /**
     * A text input for example a message from a user
     */
    text: zod_1.z.string(),
});
exports.InputImage = exports.SharedBase.extend({
    type: zod_1.z.literal('input_image'),
    /**
     * The image input to the model. Could be provided inline (`image`), as a URL, or by reference to a
     * previously uploaded OpenAI file.
     */
    image: zod_1.z
        // 1. image data
        .string()
        // 2.file ID for the image
        .or(zod_1.z.object({ id: zod_1.z.string().describe('OpenAI file ID') }))
        .describe('Either base64 encoded image data, a data URL, or an object with a file ID.')
        .optional(),
    /**
     * Controls the level of detail requested for image understanding tasks.
     * Future models may add new values, therefore this accepts any string.
     */
    detail: zod_1.z.string().optional(),
});
exports.InputFile = exports.SharedBase.extend({
    type: zod_1.z.literal('input_file'),
    /**
     * The file input to the model. Could be raw data, a URL, or an OpenAI file ID.
     * When passing a string, it is interpreted as inline data or a URL; use `{ id }` for file IDs.
     */
    file: zod_1.z
        // 1. file data
        .string()
        .describe('Either base64 encoded file data or a publicly accessible file URL')
        // 2. file ID
        .or(zod_1.z.object({ id: zod_1.z.string().describe('OpenAI file ID') }))
        // 3. publicly accessible file URL
        .or(zod_1.z.object({ url: zod_1.z.string().describe('Publicly accessible file URL') }))
        .describe('Contents of the file or an object with a file ID.')
        .optional(),
    /**
     * Optional filename metadata when uploading file data inline.
     */
    filename: zod_1.z.string().optional(),
});
exports.AudioContent = exports.SharedBase.extend({
    type: zod_1.z.literal('audio'),
    /**
     * The audio input to the model. Could be base64 encoded audio data or an object with a file ID.
     */
    audio: zod_1.z
        .string()
        .or(zod_1.z.object({
        id: zod_1.z.string(),
    }))
        .describe('Base64 encoded audio data or file id'),
    /**
     * The format of the audio.
     */
    format: zod_1.z.string().nullable().optional(),
    /**
     * The transcript of the audio.
     */
    transcript: zod_1.z.string().nullable().optional(),
});
exports.ImageContent = exports.SharedBase.extend({
    type: zod_1.z.literal('image'),
    /**
     * The image input to the model. Could be base64 encoded image data or an object with a file ID.
     */
    image: zod_1.z.string().describe('Base64 encoded image data'),
});
exports.ToolOutputText = exports.SharedBase.extend({
    type: zod_1.z.literal('text'),
    /**
     * The text output from the model.
     */
    text: zod_1.z.string(),
});
const ImageDataObjectSchema = zod_1.z.object({
    data: zod_1.z
        .union([zod_1.z.string(), zod_1.z.instanceof(Uint8Array)])
        .describe('Base64 image data, or raw bytes that will be base64 encoded automatically.'),
    mediaType: zod_1.z.string().optional(),
});
const ImageUrlObjectSchema = zod_1.z.object({
    url: zod_1.z
        .string()
        .describe('Publicly accessible URL pointing to the image content'),
});
const ImageFileIdObjectSchema = zod_1.z.object({
    fileId: zod_1.z
        .string()
        .describe('OpenAI file ID referencing uploaded image content'),
});
const ImageObjectSchema = zod_1.z
    .union([ImageDataObjectSchema, ImageUrlObjectSchema, ImageFileIdObjectSchema])
    .describe('Inline image data or references to uploaded content.');
const FileDataObjectSchema = zod_1.z.object({
    data: zod_1.z
        .union([zod_1.z.string(), zod_1.z.instanceof(Uint8Array)])
        .describe('Base64 encoded file data, or raw bytes that will be encoded automatically.'),
    mediaType: zod_1.z
        .string()
        .describe('IANA media type describing the file contents'),
    filename: zod_1.z.string().describe('Filename associated with the inline data'),
});
const FileUrlObjectSchema = zod_1.z.object({
    url: zod_1.z.string().describe('Publicly accessible URL for the file content'),
    filename: zod_1.z.string().optional(),
});
const FileIdObjectSchema = zod_1.z.object({
    id: zod_1.z.string().describe('OpenAI file ID referencing uploaded content'),
    filename: zod_1.z.string().optional(),
});
const FileReferenceSchema = zod_1.z
    .union([
    zod_1.z.string().describe('Existing data URL or base64 string'),
    FileDataObjectSchema,
    FileUrlObjectSchema,
    FileIdObjectSchema,
])
    .describe('Inline data (with metadata) or references pointing to file contents.');
const zStringWithHints = (..._hints) => zod_1.z.string();
exports.ToolOutputImage = exports.SharedBase.extend({
    type: zod_1.z.literal('image'),
    /**
     * Inline image content or a reference to an uploaded file. Accepts a URL/data URL string or an
     * object describing the data/url/fileId source.
     */
    image: zod_1.z.string().or(ImageObjectSchema).optional(),
    /**
     * Controls the requested level of detail for vision models.
     * Use a string to avoid constraining future model capabilities.
     */
    detail: zStringWithHints('low', 'high', 'auto').optional(),
});
exports.ToolOutputFileContent = exports.SharedBase.extend({
    type: zod_1.z.literal('file'),
    /**
     * File output reference. Provide either a string (data URL / base64), a data object (requires
     * mediaType + filename), or an object pointing to an uploaded file/URL.
     */
    file: FileReferenceSchema,
});
exports.ComputerToolOutput = exports.SharedBase.extend({
    type: zod_1.z.literal('computer_screenshot'),
    /**
     * A base64 encoded image data or a URL representing the screenshot.
     */
    data: zod_1.z.string().describe('Base64 encoded image data or URL'),
});
exports.computerActions = zod_1.z.discriminatedUnion('type', [
    zod_1.z.object({ type: zod_1.z.literal('screenshot') }),
    zod_1.z.object({
        type: zod_1.z.literal('click'),
        x: zod_1.z.number(),
        y: zod_1.z.number(),
        button: zod_1.z.enum(['left', 'right', 'wheel', 'back', 'forward']),
    }),
    zod_1.z.object({
        type: zod_1.z.literal('double_click'),
        x: zod_1.z.number(),
        y: zod_1.z.number(),
    }),
    zod_1.z.object({
        type: zod_1.z.literal('scroll'),
        x: zod_1.z.number(),
        y: zod_1.z.number(),
        scroll_x: zod_1.z.number(),
        scroll_y: zod_1.z.number(),
    }),
    zod_1.z.object({
        type: zod_1.z.literal('type'),
        text: zod_1.z.string(),
    }),
    zod_1.z.object({ type: zod_1.z.literal('wait') }),
    zod_1.z.object({
        type: zod_1.z.literal('move'),
        x: zod_1.z.number(),
        y: zod_1.z.number(),
    }),
    zod_1.z.object({
        type: zod_1.z.literal('keypress'),
        keys: zod_1.z.array(zod_1.z.string()),
    }),
    zod_1.z.object({
        type: zod_1.z.literal('drag'),
        path: zod_1.z.array(zod_1.z.object({ x: zod_1.z.number(), y: zod_1.z.number() })),
    }),
]);
// ----------------------------
// Message types
// ----------------------------
exports.AssistantContent = zod_1.z.discriminatedUnion('type', [
    exports.OutputText,
    exports.Refusal,
    exports.AudioContent,
    exports.ImageContent,
]);
const MessageBase = exports.ItemBase.extend({
    /**
     * Any item without a type is treated as a message
     */
    type: zod_1.z.literal('message').optional(),
});
exports.AssistantMessageItem = MessageBase.extend({
    /**
     * Representing a message from the assistant (i.e. the model)
     */
    role: zod_1.z.literal('assistant'),
    /**
     * The status of the message.
     */
    status: zod_1.z.enum(['in_progress', 'completed', 'incomplete']),
    /**
     * The content of the message.
     */
    content: zod_1.z.array(exports.AssistantContent),
});
exports.UserContent = zod_1.z.discriminatedUnion('type', [
    exports.InputText,
    exports.InputImage,
    exports.InputFile,
    exports.AudioContent,
]);
exports.UserMessageItem = MessageBase.extend({
    // type: z.literal('message'),
    /**
     * Representing a message from the user
     */
    role: zod_1.z.literal('user'),
    /**
     * The content of the message.
     */
    content: zod_1.z.array(exports.UserContent).or(zod_1.z.string()),
});
const SystemMessageItem = MessageBase.extend({
    // type: z.literal('message'),
    /**
     * Representing a system message to the user
     */
    role: zod_1.z.literal('system'),
    /**
     * The content of the message.
     */
    content: zod_1.z.string(),
});
exports.MessageItem = zod_1.z.discriminatedUnion('role', [
    SystemMessageItem,
    exports.AssistantMessageItem,
    exports.UserMessageItem,
]);
// ----------------------------
// Tool call types
// ----------------------------
exports.HostedToolCallItem = exports.ItemBase.extend({
    type: zod_1.z.literal('hosted_tool_call'),
    /**
     * The name of the hosted tool. For example `web_search_call` or `file_search_call`
     */
    name: zod_1.z.string().describe('The name of the hosted tool'),
    /**
     * The arguments of the hosted tool call.
     */
    arguments: zod_1.z
        .string()
        .describe('The arguments of the hosted tool call')
        .optional(),
    /**
     * The status of the tool call.
     */
    status: zod_1.z.string().optional(),
    /**
     * The primary output of the tool call. Additional output might be in the `providerData` field.
     */
    output: zod_1.z.string().optional(),
});
exports.FunctionCallItem = exports.ItemBase.extend({
    type: zod_1.z.literal('function_call'),
    /**
     * The ID of the tool call. Required to match up the respective tool call result.
     */
    callId: zod_1.z.string().describe('The ID of the tool call'),
    /**
     * The name of the function.
     */
    name: zod_1.z.string().describe('The name of the function'),
    /**
     * The status of the function call.
     */
    status: zod_1.z.enum(['in_progress', 'completed', 'incomplete']).optional(),
    /**
     * The arguments of the function call.
     */
    arguments: zod_1.z.string(),
});
exports.ToolCallOutputContent = zod_1.z.discriminatedUnion('type', [
    exports.ToolOutputText,
    exports.ToolOutputImage,
    exports.ToolOutputFileContent,
]);
exports.ToolCallStructuredOutput = zod_1.z.discriminatedUnion('type', [
    exports.InputText,
    exports.InputImage,
    exports.InputFile,
]);
exports.FunctionCallResultItem = exports.ItemBase.extend({
    type: zod_1.z.literal('function_call_result'),
    /**
     * The name of the tool that was called
     */
    name: zod_1.z.string().describe('The name of the tool'),
    /**
     * The ID of the tool call. Required to match up the respective tool call result.
     */
    callId: zod_1.z.string().describe('The ID of the tool call'),
    /**
     * The status of the tool call.
     */
    status: zod_1.z.enum(['in_progress', 'completed', 'incomplete']),
    /**
     * The output of the tool call.
     */
    output: zod_1.z
        .union([
        zod_1.z.string(),
        exports.ToolCallOutputContent,
        zod_1.z.array(exports.ToolCallStructuredOutput),
    ])
        .describe('Output returned by the tool call. Supports plain strings, legacy ToolOutput items, or structured input_* items.'),
});
exports.ComputerUseCallItem = exports.ItemBase.extend({
    type: zod_1.z.literal('computer_call'),
    /**
     * The ID of the computer call. Required to match up the respective computer call result.
     */
    callId: zod_1.z.string().describe('The ID of the computer call'),
    /**
     * The status of the computer call.
     */
    status: zod_1.z.enum(['in_progress', 'completed', 'incomplete']),
    /**
     * The action to be performed by the computer.
     */
    action: exports.computerActions,
});
exports.ComputerCallResultItem = exports.ItemBase.extend({
    type: zod_1.z.literal('computer_call_result'),
    /**
     * The ID of the computer call. Required to match up the respective computer call result.
     */
    callId: zod_1.z.string().describe('The ID of the computer call'),
    /**
     * The output of the computer call.
     */
    output: exports.ComputerToolOutput,
});
exports.ShellAction = zod_1.z.object({
    commands: zod_1.z.array(zod_1.z.string()),
    timeoutMs: zod_1.z.number().int().min(0).optional(),
    maxOutputLength: zod_1.z.number().int().min(0).optional(),
});
exports.ShellCallItem = exports.ItemBase.extend({
    type: zod_1.z.literal('shell_call'),
    callId: zod_1.z.string(),
    status: zod_1.z.enum(['in_progress', 'completed', 'incomplete']).optional(),
    action: exports.ShellAction,
});
exports.ShellCallOutcome = zod_1.z.discriminatedUnion('type', [
    zod_1.z.object({ type: zod_1.z.literal('timeout') }),
    zod_1.z.object({
        type: zod_1.z.literal('exit'),
        exitCode: zod_1.z.number().int().nullable(),
    }),
]);
exports.ShellCallOutputContent = zod_1.z
    .object({
    stdout: zod_1.z.string(),
    stderr: zod_1.z.string(),
    outcome: exports.ShellCallOutcome,
})
    .passthrough();
exports.ShellCallResultItem = exports.ItemBase.extend({
    type: zod_1.z.literal('shell_call_output'),
    callId: zod_1.z.string(),
    maxOutputLength: zod_1.z.number().optional(),
    output: zod_1.z.array(exports.ShellCallOutputContent),
});
exports.ApplyPatchOperationCreateFile = zod_1.z.object({
    type: zod_1.z.literal('create_file'),
    path: zod_1.z.string(),
    diff: zod_1.z.string(),
});
exports.ApplyPatchOperationUpdateFile = zod_1.z.object({
    type: zod_1.z.literal('update_file'),
    path: zod_1.z.string(),
    diff: zod_1.z.string(),
});
exports.ApplyPatchOperationDeleteFile = zod_1.z.object({
    type: zod_1.z.literal('delete_file'),
    path: zod_1.z.string(),
});
exports.ApplyPatchOperation = zod_1.z.discriminatedUnion('type', [
    exports.ApplyPatchOperationCreateFile,
    exports.ApplyPatchOperationUpdateFile,
    exports.ApplyPatchOperationDeleteFile,
]);
exports.ApplyPatchCallItem = exports.ItemBase.extend({
    type: zod_1.z.literal('apply_patch_call'),
    callId: zod_1.z.string(),
    status: zod_1.z.enum(['in_progress', 'completed']),
    operation: exports.ApplyPatchOperation,
});
exports.ApplyPatchCallResultItem = exports.ItemBase.extend({
    type: zod_1.z.literal('apply_patch_call_output'),
    callId: zod_1.z.string(),
    status: zod_1.z.enum(['completed', 'failed']),
    output: zod_1.z.string().optional(),
});
exports.ToolCallItem = zod_1.z.discriminatedUnion('type', [
    exports.ComputerUseCallItem,
    exports.ShellCallItem,
    exports.ApplyPatchCallItem,
    exports.FunctionCallItem,
    exports.HostedToolCallItem,
]);
// ----------------------------
// Special item types
// ----------------------------
exports.ReasoningItem = exports.SharedBase.extend({
    id: zod_1.z.string().optional(),
    type: zod_1.z.literal('reasoning'),
    /**
     * The user facing representation of the reasoning. Additional information might be in the `providerData` field.
     */
    content: zod_1.z.array(exports.InputText),
    /**
     * The raw reasoning text from the model.
     */
    rawContent: zod_1.z.array(exports.ReasoningText).optional(),
});
exports.CompactionItem = exports.ItemBase.extend({
    type: zod_1.z.literal('compaction'),
    /**
     * Encrypted payload returned by the compaction endpoint.
     */
    encrypted_content: zod_1.z.string(),
    /**
     * Identifier for the compaction item.
     */
    id: zod_1.z.string().optional(),
    /**
     * Identifier for the generator of this compaction item.
     */
    created_by: zod_1.z.string().optional(),
});
/**
 * This is a catch all for items that are not part of the protocol.
 *
 * For example, a model might return an item that is not part of the protocol using this type.
 *
 * In that case everything returned from the model should be passed in the `providerData` field.
 *
 * This enables new features to be added to be added by a model provider without breaking the protocol.
 */
exports.UnknownItem = exports.ItemBase.extend({
    type: zod_1.z.literal('unknown'),
});
// ----------------------------
// Joined item types
// ----------------------------
exports.OutputModelItem = zod_1.z.discriminatedUnion('type', [
    exports.AssistantMessageItem,
    exports.HostedToolCallItem,
    exports.FunctionCallItem,
    exports.ComputerUseCallItem,
    exports.ShellCallItem,
    exports.ApplyPatchCallItem,
    exports.FunctionCallResultItem,
    exports.ShellCallResultItem,
    exports.ApplyPatchCallResultItem,
    exports.ReasoningItem,
    exports.CompactionItem,
    exports.UnknownItem,
]);
exports.ModelItem = zod_1.z.union([
    exports.UserMessageItem,
    exports.AssistantMessageItem,
    SystemMessageItem,
    exports.HostedToolCallItem,
    exports.FunctionCallItem,
    exports.ComputerUseCallItem,
    exports.ShellCallItem,
    exports.ApplyPatchCallItem,
    exports.FunctionCallResultItem,
    exports.ComputerCallResultItem,
    exports.ShellCallResultItem,
    exports.ApplyPatchCallResultItem,
    exports.ReasoningItem,
    exports.CompactionItem,
    exports.UnknownItem,
]);
// ----------------------------
// Meta data types
// ----------------------------
exports.RequestUsageData = zod_1.z.object({
    inputTokens: zod_1.z.number(),
    outputTokens: zod_1.z.number(),
    totalTokens: zod_1.z.number(),
    inputTokensDetails: zod_1.z.record(zod_1.z.string(), zod_1.z.number()).optional(),
    outputTokensDetails: zod_1.z.record(zod_1.z.string(), zod_1.z.number()).optional(),
    endpoint: zod_1.z.string().optional(),
});
exports.UsageData = zod_1.z.object({
    requests: zod_1.z.number().optional(),
    inputTokens: zod_1.z.number(),
    outputTokens: zod_1.z.number(),
    totalTokens: zod_1.z.number(),
    inputTokensDetails: zod_1.z
        .union([
        zod_1.z.record(zod_1.z.string(), zod_1.z.number()),
        zod_1.z.array(zod_1.z.record(zod_1.z.string(), zod_1.z.number())),
    ])
        .optional(),
    outputTokensDetails: zod_1.z
        .union([
        zod_1.z.record(zod_1.z.string(), zod_1.z.number()),
        zod_1.z.array(zod_1.z.record(zod_1.z.string(), zod_1.z.number())),
    ])
        .optional(),
    requestUsageEntries: zod_1.z.array(exports.RequestUsageData).optional(),
});
// ----------------------------
// Stream event types
// ----------------------------
/**
 * Event returned by the model when new output text is available to stream to the user.
 */
exports.StreamEventTextStream = exports.SharedBase.extend({
    type: zod_1.z.literal('output_text_delta'),
    /**
     * The delta text that was streamed by the modelto the user.
     */
    delta: zod_1.z.string(),
});
/**
 * Event returned by the model when a new response is started.
 */
exports.StreamEventResponseStarted = exports.SharedBase.extend({
    type: zod_1.z.literal('response_started'),
});
/**
 * Event returned by the model when a response is completed.
 */
exports.StreamEventResponseCompleted = exports.SharedBase.extend({
    type: zod_1.z.literal('response_done'),
    /**
     * The response from the model.
     */
    response: exports.SharedBase.extend({
        /**
         * The ID of the response.
         */
        id: zod_1.z.string(),
        /**
         * The usage data for the response.
         */
        usage: exports.UsageData,
        /**
         * The output from the model.
         */
        output: zod_1.z.array(exports.OutputModelItem),
    }),
});
/**
 * Event returned for every item that gets streamed to the model. Used to expose the raw events
 * from the model.
 */
exports.StreamEventGenericItem = exports.SharedBase.extend({
    type: zod_1.z.literal('model'),
    event: zod_1.z.any().describe('The event from the model'),
});
exports.StreamEvent = zod_1.z.discriminatedUnion('type', [
    exports.StreamEventTextStream,
    exports.StreamEventResponseCompleted,
    exports.StreamEventResponseStarted,
    exports.StreamEventGenericItem,
]);
//# sourceMappingURL=protocol.js.map