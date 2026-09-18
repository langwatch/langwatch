import * as WS from 'ws';
import { AzureOpenAI, OpenAI } from "../index.mjs";
import type { RealtimeClientEvent } from "../resources/realtime/realtime.mjs";
import { OpenAIRealtimeEmitter, type AzureRealtimeConnectionConfig, type RealtimeConnectionConfig } from "./internal-base.mjs";
export declare class OpenAIRealtimeWS extends OpenAIRealtimeEmitter {
    url: URL;
    socket: WS.WebSocket;
    constructor(props: RealtimeConnectionConfig & {
        options?: WS.ClientOptions | undefined;
        /** @internal */ __resolvedApiKey?: boolean;
    }, client?: Pick<OpenAI, 'apiKey' | 'baseURL'>);
    static create(client: Pick<OpenAI, 'apiKey' | 'baseURL' | '_callApiKey'>, props: RealtimeConnectionConfig & {
        options?: WS.ClientOptions | undefined;
    }): Promise<OpenAIRealtimeWS>;
    static azure(client: Pick<AzureOpenAI, '_callApiKey' | 'apiVersion' | 'apiKey' | 'baseURL' | 'deploymentName'>, props?: AzureRealtimeConnectionConfig & {
        options?: WS.ClientOptions | undefined;
    }): Promise<OpenAIRealtimeWS>;
    send(event: RealtimeClientEvent): void;
    close(props?: {
        code: number;
        reason: string;
    }): void;
}
//# sourceMappingURL=ws.d.mts.map