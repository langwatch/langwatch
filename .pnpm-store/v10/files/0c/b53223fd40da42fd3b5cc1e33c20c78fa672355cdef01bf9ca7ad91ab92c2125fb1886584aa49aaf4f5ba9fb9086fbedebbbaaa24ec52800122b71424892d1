import { HttpResponse, HttpHandler, HttpRequest } from "@smithy/core/protocols";
import { FetchHttpHandlerOptions, HttpHandlerOptions, Provider } from "@smithy/types";
export { FetchHttpHandlerOptions };
/**
 * Detection of keepalive support. Can be overridden for testing.
 *
 * @internal
 */
export declare const keepAliveSupport: {
    supported: undefined | boolean;
};
/**
 * @internal
 */
export type AdditionalRequestParameters = {
    duplex?: "half";
};
/**
 * HttpHandler implementation using browsers' `fetch` global function.
 *
 * @public
 */
export declare class FetchHttpHandler implements HttpHandler<FetchHttpHandlerOptions> {
    private config?;
    private configProvider;
    /**
     * @returns the input if it is an HttpHandler of any class,
     * or instantiates a new instance of this handler.
     */
    static create(instanceOrOptions?: HttpHandler<any> | FetchHttpHandlerOptions | Provider<FetchHttpHandlerOptions | void>): FetchHttpHandler | HttpHandler<any>;
    constructor(options?: FetchHttpHandlerOptions | Provider<FetchHttpHandlerOptions | void>);
    destroy(): void;
    handle(request: HttpRequest, { abortSignal, requestTimeout }?: HttpHandlerOptions): Promise<{
        response: HttpResponse;
    }>;
    updateHttpClientConfig(key: keyof FetchHttpHandlerOptions, value: FetchHttpHandlerOptions[typeof key]): void;
    httpHandlerConfigs(): FetchHttpHandlerOptions;
}
