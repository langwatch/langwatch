import { AzureOpenAI, OpenAI } from "../index.js";
import type { RealtimeClientEvent } from "../resources/realtime/realtime.js";
import { OpenAIRealtimeEmitter, type AzureRealtimeConnectionConfig, type RealtimeConnectionConfig } from "./internal-base.js";
type _WebSocket = typeof globalThis extends ({
    WebSocket: infer ws extends abstract new (...args: any) => any;
}) ? InstanceType<ws> : any;
export declare class OpenAIRealtimeWebSocket extends OpenAIRealtimeEmitter {
    url: URL;
    socket: _WebSocket;
    constructor(props: RealtimeConnectionConfig & {
        dangerouslyAllowBrowser?: boolean;
        /**
         * Callback to mutate the URL, needed for Azure.
         * @internal
         */
        onURL?: (url: URL) => void;
        /** Indicates the token was resolved by the factory just before connecting. @internal */
        __resolvedApiKey?: boolean;
    }, client?: Pick<OpenAI, 'apiKey' | 'baseURL'>);
    static create(client: Pick<OpenAI, 'apiKey' | 'baseURL' | '_callApiKey'>, props: RealtimeConnectionConfig & {
        dangerouslyAllowBrowser?: boolean;
    }): Promise<OpenAIRealtimeWebSocket>;
    static azure(client: Pick<AzureOpenAI, '_callApiKey' | 'apiVersion' | 'apiKey' | 'baseURL' | 'deploymentName'>, options?: AzureRealtimeConnectionConfig & {
        dangerouslyAllowBrowser?: boolean;
    }): Promise<OpenAIRealtimeWebSocket>;
    send(event: RealtimeClientEvent): void;
    close(props?: {
        code: number;
        reason: string;
    }): void;
}
export {};
//# sourceMappingURL=websocket.d.ts.map