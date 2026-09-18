import { type ChatCompletionChunk, type ChatCompletionCreateParamsStreaming } from "../resources/chat/completions.js";
import { RunnerOptions, type AbstractChatCompletionRunnerEvents } from "./AbstractChatCompletionRunner.js";
import { type ReadableStream } from "../internal/shim-types.js";
import { RunnableTools, type BaseFunctionsArgs } from "./RunnableFunction.js";
import { ChatCompletionSnapshot, ChatCompletionStream } from "./ChatCompletionStream.js";
import OpenAI from "../index.js";
import { AutoParseableTool } from "../lib/parser.js";
export interface ChatCompletionStreamEvents extends AbstractChatCompletionRunnerEvents {
    content: (contentDelta: string, contentSnapshot: string) => void;
    chunk: (chunk: ChatCompletionChunk, snapshot: ChatCompletionSnapshot) => void;
}
type ChatCompletionStreamingToolRunnerParamsBase = Omit<ChatCompletionCreateParamsStreaming, 'tools'>;
/**
 * Parameters for tools that do not require a context value.
 */
export type ChatCompletionStreamingToolRunnerParamsWithoutContext<FunctionsArgs extends BaseFunctionsArgs> = ChatCompletionStreamingToolRunnerParamsBase & {
    tools: RunnableTools<FunctionsArgs> | AutoParseableTool<any, true>[];
    toolContext?: never;
};
/**
 * Parameters for tools that require a context value.
 */
export type ChatCompletionStreamingToolRunnerParamsWithContext<FunctionsArgs extends BaseFunctionsArgs, ToolContext> = ChatCompletionStreamingToolRunnerParamsBase & {
    tools: RunnableTools<FunctionsArgs, ToolContext> | AutoParseableTool<any, true>[];
    /**
     * Context to pass to each tool callback during this run.
     */
    toolContext: ToolContext;
};
/**
 * Parameters for running streaming tools. Supplying a context type makes
 * `toolContext` required; omitting it preserves the existing no-context form.
 */
export type ChatCompletionStreamingToolRunnerParams<FunctionsArgs extends BaseFunctionsArgs, ToolContext = never> = [ToolContext] extends [never] ? ChatCompletionStreamingToolRunnerParamsWithoutContext<FunctionsArgs> : ChatCompletionStreamingToolRunnerParamsWithContext<FunctionsArgs, ToolContext>;
export declare class ChatCompletionStreamingRunner<ParsedT = null> extends ChatCompletionStream<ParsedT> implements AsyncIterable<ChatCompletionChunk> {
    static fromReadableStream(stream: ReadableStream): ChatCompletionStreamingRunner<null>;
    toReadableStream(): ReadableStream;
    static runTools<T extends (string | object)[], ParsedT = null, ToolContext = unknown>(client: OpenAI, params: ChatCompletionStreamingToolRunnerParamsWithContext<T, ToolContext>, options?: RunnerOptions): ChatCompletionStreamingRunner<ParsedT>;
    static runTools<T extends (string | object)[], ParsedT = null>(client: OpenAI, params: ChatCompletionStreamingToolRunnerParamsWithoutContext<T>, options?: RunnerOptions): ChatCompletionStreamingRunner<ParsedT>;
}
export {};
//# sourceMappingURL=ChatCompletionStreamingRunner.d.ts.map