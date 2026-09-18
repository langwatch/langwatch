import { Agent as hAgentType } from "node:http";
import { Agent as hsAgentType } from "node:https";
import { HttpResponse, HttpHandler, HttpRequest } from "@smithy/core/protocols";
import { HttpHandlerOptions, Logger, NodeHttpHandlerOptions, Provider } from "@smithy/types";
export { NodeHttpHandlerOptions };
/**
 * A default of 0 means no timeout.
 *
 * @public
 */
export declare const DEFAULT_REQUEST_TIMEOUT = 0;
/**
 * A request handler that uses the Node.js http and https modules.
 *
 * @public
 */
export declare class NodeHttpHandler implements HttpHandler<NodeHttpHandlerOptions> {
    private config?;
    private configProvider;
    private socketWarningTimestamp;
    private externalAgent;
    readonly metadata: {
        handlerProtocol: string;
    };
    /**
     * @returns the input if it is an HttpHandler of any class,
     * or instantiates a new instance of this handler.
     */
    static create(instanceOrOptions?: HttpHandler<any> | NodeHttpHandlerOptions | Provider<NodeHttpHandlerOptions | void>): NodeHttpHandler | HttpHandler<any>;
    /**
     * @internal
     *
     * @param agent - http(s) agent in use by the NodeHttpHandler instance.
     * @param socketWarningTimestamp - last socket usage check timestamp.
     * @param logger - channel for the warning.
     * @returns timestamp of last emitted warning.
     */
    static checkSocketUsage(agent: hAgentType | hsAgentType, socketWarningTimestamp: number, logger?: Logger): number;
    constructor(options?: NodeHttpHandlerOptions | Provider<NodeHttpHandlerOptions | void>);
    destroy(): void;
    handle(request: HttpRequest, { abortSignal, requestTimeout }?: HttpHandlerOptions): Promise<{
        response: HttpResponse;
    }>;
    updateHttpClientConfig(key: keyof NodeHttpHandlerOptions, value: NodeHttpHandlerOptions[typeof key]): void;
    httpHandlerConfigs(): NodeHttpHandlerOptions;
    private resolveDefaultConfig;
}
