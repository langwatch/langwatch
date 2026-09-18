import * as ResponsesAPI from "./responses.js";
import { OpenAI } from "../../../client.js";
import { EventEmitter } from "../../../core/EventEmitter.js";
import { OpenAIError } from "../../../core/error.js";
import type { RawWebSocketData, ReconnectingEvent, UnsentMessage } from "../../../internal/ws.js";
export type ResponsesStreamMessage = {
    type: 'connecting' | 'open' | 'closing';
} | {
    type: 'close';
    code: number;
    reason: string;
    unsent: UnsentMessage<ResponsesAPI.BetaResponsesClientEvent>[];
} | {
    type: 'reconnecting';
    reconnect: ReconnectingEvent;
} | {
    type: 'reconnected';
} | {
    type: 'message';
    message: ResponsesAPI.BetaResponsesServerEvent;
} | {
    type: 'raw';
    data: RawWebSocketData;
} | {
    type: 'error';
    error: WebSocketError;
};
export declare class WebSocketError extends OpenAIError {
    /**
     * The error data that the API sent back in an error event.
     */
    error?: ResponsesAPI.BetaResponseErrorEvent | undefined;
    constructor(message: string, event: ResponsesAPI.BetaResponseErrorEvent | null);
}
type Simplify<T> = {
    [KeyType in keyof T]: T[KeyType];
} & {};
type WebSocketEvents = Simplify<{
    event: (event: ResponsesAPI.BetaResponsesServerEvent) => void;
    raw: (data: RawWebSocketData) => void;
    error: (error: WebSocketError) => void;
    close: (code: number, reason: string, unsent: UnsentMessage<ResponsesAPI.BetaResponsesClientEvent>[]) => void;
    reconnecting: (event: ReconnectingEvent) => void;
    reconnected: () => void;
} & {
    [EventType in Exclude<NonNullable<ResponsesAPI.BetaResponsesServerEvent['type']>, 'error'>]: (event: Extract<ResponsesAPI.BetaResponsesServerEvent, {
        type?: EventType;
    }>) => unknown;
}>;
export declare abstract class ResponsesEmitter extends EventEmitter<WebSocketEvents> {
    /**
     * Send an event to the API.
     */
    abstract send(event: ResponsesAPI.BetaResponsesClientEvent): void;
    /**
     * Send raw data over the WebSocket without JSON serialization.
     */
    abstract sendRaw(data: RawWebSocketData): void;
    /**
     * Close the WebSocket connection.
     */
    abstract close(props?: {
        code: number;
        reason: string;
    }): void;
    protected _onError(event: null, message: string, cause: any): void;
    protected _onError(event: ResponsesAPI.BetaResponseErrorEvent, message?: string | undefined): void;
}
export declare function buildURL(client: OpenAI, parameters: Record<string, unknown>): URL;
export {};
//# sourceMappingURL=internal-base.d.ts.map