import type { ChatCompletionAssistantMessageParam, ChatCompletionContentPart, ChatCompletionMessageParam, ChatCompletionTool, ChatCompletionToolChoiceOption } from 'openai/resources/chat';
import { SerializedHandoff, SerializedTool, ModelRequest, protocol } from '@openai/agents-core';
export declare function convertToolChoice(toolChoice: 'auto' | 'required' | 'none' | (string & {}) | undefined | null): ChatCompletionToolChoiceOption | undefined;
export declare function extractAllAssistantContent(content: protocol.AssistantMessageItem['content']): string | ChatCompletionAssistantMessageParam['content'];
export declare function extractAllUserContent(content: protocol.UserMessageItem['content']): string | ChatCompletionContentPart[];
export declare function itemsToMessages(items: ModelRequest['input']): ChatCompletionMessageParam[];
export declare function toolToOpenAI(tool: SerializedTool): ChatCompletionTool;
export declare function convertHandoffTool(handoff: SerializedHandoff): ChatCompletionTool;
