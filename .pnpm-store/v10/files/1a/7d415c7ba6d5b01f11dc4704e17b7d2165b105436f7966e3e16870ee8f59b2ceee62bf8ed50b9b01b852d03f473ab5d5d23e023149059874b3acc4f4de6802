import { type ChatCompletionMessageParam, type ChatCompletionCreateParamsNonStreaming } from "../resources/chat/completions.js";
import { type BaseFunctionsArgs, RunnableTools } from "./RunnableFunction.js";
import { AbstractChatCompletionRunner, AbstractChatCompletionRunnerEvents, RunnerOptions } from "./AbstractChatCompletionRunner.js";
import OpenAI from "../index.js";
import { AutoParseableTool } from "../lib/parser.js";
export interface ChatCompletionRunnerEvents extends AbstractChatCompletionRunnerEvents {
    content: (content: string) => void;
}
type ChatCompletionToolRunnerParamsBase = Omit<ChatCompletionCreateParamsNonStreaming, 'tools'>;
/**
 * Parameters for tools that do not require a context value.
 */
export type ChatCompletionToolRunnerParamsWithoutContext<FunctionsArgs extends BaseFunctionsArgs> = ChatCompletionToolRunnerParamsBase & {
    tools: RunnableTools<FunctionsArgs> | AutoParseableTool<any, true>[];
    toolContext?: never;
};
/**
 * Parameters for tools that require a context value.
 */
export type ChatCompletionToolRunnerParamsWithContext<FunctionsArgs extends BaseFunctionsArgs, ToolContext> = ChatCompletionToolRunnerParamsBase & {
    tools: RunnableTools<FunctionsArgs, ToolContext> | AutoParseableTool<any, true>[];
    /**
     * Context to pass to each tool callback during this run.
     */
    toolContext: ToolContext;
};
/**
 * Parameters for running tools. Supplying a context type makes `toolContext`
 * required; omitting it preserves the existing no-context form.
 */
export type ChatCompletionToolRunnerParams<FunctionsArgs extends BaseFunctionsArgs, ToolContext = never> = [
    ToolContext
] extends [never] ? ChatCompletionToolRunnerParamsWithoutContext<FunctionsArgs> : ChatCompletionToolRunnerParamsWithContext<FunctionsArgs, ToolContext>;
export declare class ChatCompletionRunner<ParsedT = null> extends AbstractChatCompletionRunner<ChatCompletionRunnerEvents, ParsedT> {
    static runTools<ParsedT, ToolContext = unknown>(client: OpenAI, params: ChatCompletionToolRunnerParamsWithContext<any[], ToolContext>, options?: RunnerOptions): ChatCompletionRunner<ParsedT>;
    static runTools<ParsedT>(client: OpenAI, params: ChatCompletionToolRunnerParamsWithoutContext<any[]>, options?: RunnerOptions): ChatCompletionRunner<ParsedT>;
    _addMessage(this: ChatCompletionRunner<ParsedT>, message: ChatCompletionMessageParam, emit?: boolean): void;
}
export {};
//# sourceMappingURL=ChatCompletionRunner.d.ts.map