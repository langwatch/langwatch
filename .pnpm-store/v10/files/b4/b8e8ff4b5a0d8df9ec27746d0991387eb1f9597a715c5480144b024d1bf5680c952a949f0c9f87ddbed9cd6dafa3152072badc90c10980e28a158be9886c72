import type { Stream } from 'openai/streaming';
import { protocol } from '@openai/agents-core';
import { ChatCompletion, ChatCompletionChunk } from 'openai/resources/chat';
export declare function convertChatCompletionsStreamToResponses(response: ChatCompletion, stream: Stream<ChatCompletionChunk>): AsyncIterable<protocol.StreamEvent>;
