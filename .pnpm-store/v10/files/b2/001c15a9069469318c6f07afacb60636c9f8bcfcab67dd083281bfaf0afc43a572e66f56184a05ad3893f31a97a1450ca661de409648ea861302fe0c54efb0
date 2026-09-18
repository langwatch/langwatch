import { ChatCompletionStream, makeChatCompletionReadableStreamMessageChunk, } from "./ChatCompletionStream.mjs";
import { OpenAIError } from "../error.mjs";
import { Stream } from "../streaming.mjs";
import { isAssistantMessage, isToolMessage } from "./chatCompletionUtils.mjs";
export class ChatCompletionStreamingRunner extends ChatCompletionStream {
    static fromReadableStream(stream) {
        const runner = new ChatCompletionStreamingRunner(null);
        runner._run(() => runner._fromReadableStream(stream));
        return runner;
    }
    toReadableStream() {
        const pushQueue = [];
        const readQueue = [];
        let done = false;
        let lastChunk;
        let toolCallIds;
        const pushEvent = (event) => {
            const reader = readQueue.shift();
            if (reader) {
                reader.resolve(event);
            }
            else {
                pushQueue.push(event);
            }
        };
        this.on('chunk', (chunk) => {
            lastChunk = chunk;
            pushEvent(chunk);
        });
        this.on('message', (message) => {
            if (isAssistantMessage(message)) {
                toolCallIds = message.tool_calls?.map((toolCall) => toolCall.id);
                return;
            }
            if (isToolMessage(message)) {
                if (!lastChunk) {
                    throw new OpenAIError('cannot serialize a tool message before receiving any chunks');
                }
                pushEvent(makeChatCompletionReadableStreamMessageChunk(lastChunk, message, toolCallIds));
            }
        });
        this.on('end', () => {
            done = true;
            for (const reader of readQueue) {
                reader.resolve(undefined);
            }
            readQueue.length = 0;
        });
        this.on('abort', (err) => {
            done = true;
            for (const reader of readQueue) {
                reader.reject(err);
            }
            readQueue.length = 0;
        });
        this.on('error', (err) => {
            done = true;
            for (const reader of readQueue) {
                reader.reject(err);
            }
            readQueue.length = 0;
        });
        const iterator = () => ({
            next: async () => {
                if (!pushQueue.length) {
                    if (done) {
                        return { value: undefined, done: true };
                    }
                    return new Promise((resolve, reject) => readQueue.push({ resolve, reject })).then((event) => (event ? { value: event, done: false } : { value: undefined, done: true }));
                }
                const event = pushQueue.shift();
                if (!event) {
                    return { value: undefined, done: true };
                }
                return { value: event, done: false };
            },
            return: async () => {
                this.abort();
                return { value: undefined, done: true };
            },
        });
        const stream = new Stream(iterator, this.controller);
        return stream.toReadableStream();
    }
    static runTools(client, params, options) {
        const runner = new ChatCompletionStreamingRunner(
        // @ts-expect-error TODO these types are incompatible
        params);
        const opts = {
            ...options,
            headers: { ...options?.headers, 'X-Stainless-Helper-Method': 'runTools' },
        };
        runner._run(() => runner._runTools(client, params, runner, opts));
        return runner;
    }
}
//# sourceMappingURL=ChatCompletionStreamingRunner.mjs.map