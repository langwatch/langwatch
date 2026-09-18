import { RealtimeClientEvent, RealtimeServerEvent, RealtimeErrorEvent, RealtimeError } from "../resources/realtime/realtime.mjs";
import { EventEmitter } from "../lib/EventEmitter.mjs";
import { OpenAIError } from "../error.mjs";
import OpenAI, { AzureOpenAI } from "../index.mjs";
export declare class OpenAIRealtimeError extends OpenAIError {
    /**
     * The error data that the API sent back in an `error` event.
     */
    error?: RealtimeError | undefined;
    /**
     * The unique ID of the server event.
     */
    event_id?: string | undefined;
    constructor(message: string, event: RealtimeErrorEvent | null);
}
type Simplify<T> = {
    [KeyType in keyof T]: T[KeyType];
} & {};
type RealtimeEvents = Simplify<{
    event: (event: RealtimeServerEvent) => void;
    error: (error: OpenAIRealtimeError) => void;
} & {
    [EventType in Exclude<RealtimeServerEvent['type'], 'error'>]: (event: Extract<RealtimeServerEvent, {
        type: EventType;
    }>) => unknown;
}>;
export declare abstract class OpenAIRealtimeEmitter extends EventEmitter<RealtimeEvents> {
    /**
     * Send an event to the API.
     */
    abstract send(event: RealtimeClientEvent): void;
    /**
     * Close the websocket connection.
     */
    abstract close(props?: {
        code: number;
        reason: string;
    }): void;
    protected _onError(event: null, message: string, cause: any): void;
    protected _onError(event: RealtimeErrorEvent, message?: string | undefined): void;
}
export declare function isAzure(client: Pick<OpenAI, 'apiKey' | 'baseURL'>): client is AzureOpenAI;
export type RealtimeConnectionConfig = {
    /**
     * Start a new Realtime session using the given model.
     */
    model: string;
    callID?: undefined;
} | {
    model?: undefined;
    /**
     * Attach to an in-progress Realtime call over a sideband control connection.
     */
    callID: string;
};
export type AzureRealtimeConnectionConfig = {
    /**
     * Override the deployment configured on the Azure client.
     */
    deploymentName?: string;
    callID?: undefined;
} | {
    deploymentName?: undefined;
    /**
     * Attach to an in-progress Azure Realtime call over a sideband control connection.
     */
    callID: string;
};
export declare function buildRealtimeURL(client: Pick<OpenAI, 'apiKey' | 'baseURL'>, connection: string | RealtimeConnectionConfig): URL;
export declare function getAzureRealtimeConnection(client: Pick<AzureOpenAI, 'deploymentName'>, connection: AzureRealtimeConnectionConfig): RealtimeConnectionConfig;
export {};
//# sourceMappingURL=internal-base.d.mts.map