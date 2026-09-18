import { HttpResponse, buildQueryString } from "@smithy/core/protocols";
import { buildAbortError } from "./build-abort-error";
import { getTransformedHeaders } from "./get-transformed-headers";
import { node_http2 } from "./node-http2";
import { NodeHttp2ConnectionManager } from "./node-http2-connection-manager";
import { writeRequestBody } from "./write-request-body";
const { constants } = node_http2;
export class NodeHttp2Handler {
    config;
    configProvider;
    metadata = { handlerProtocol: "h2" };
    connectionManager = new NodeHttp2ConnectionManager({});
    static create(instanceOrOptions) {
        if (typeof instanceOrOptions?.handle === "function") {
            return instanceOrOptions;
        }
        return new NodeHttp2Handler(instanceOrOptions);
    }
    constructor(options) {
        this.configProvider = new Promise((resolve, reject) => {
            if (typeof options === "function") {
                options()
                    .then((opts) => {
                    resolve(opts || {});
                })
                    .catch(reject);
            }
            else {
                resolve(options || {});
            }
        });
    }
    destroy() {
        this.connectionManager.destroy();
    }
    async handle(request, { abortSignal, requestTimeout, isEventStream } = {}) {
        if (!this.config) {
            this.config = await this.configProvider;
            const { disableConcurrentStreams, maxConcurrentStreams, nodeHttp2ConnectOptions } = this.config;
            this.connectionManager.setDisableConcurrentStreams(disableConcurrentStreams ?? false);
            if (maxConcurrentStreams) {
                this.connectionManager.setMaxConcurrentStreams(maxConcurrentStreams);
            }
            if (nodeHttp2ConnectOptions) {
                this.connectionManager.setNodeHttp2ConnectOptions(nodeHttp2ConnectOptions);
            }
        }
        const { requestTimeout: configRequestTimeout, disableConcurrentStreams } = this.config;
        const useIsolatedSession = disableConcurrentStreams || isEventStream;
        const effectiveRequestTimeout = requestTimeout ?? configRequestTimeout;
        return new Promise((_resolve, _reject) => {
            let fulfilled = false;
            let writeRequestBodyPromise = undefined;
            const resolve = async (arg) => {
                await writeRequestBodyPromise;
                _resolve(arg);
            };
            const reject = async (arg) => {
                await writeRequestBodyPromise;
                _reject(arg);
            };
            if (abortSignal?.aborted) {
                fulfilled = true;
                const abortError = buildAbortError(abortSignal);
                reject(abortError);
                return;
            }
            const { hostname, method, port, protocol, query } = request;
            let auth = "";
            if (request.username != null || request.password != null) {
                const username = request.username ?? "";
                const password = request.password ?? "";
                auth = `${username}:${password}@`;
            }
            const authority = `${protocol}//${auth}${hostname}${port ? `:${port}` : ""}`;
            const requestContext = { destination: new URL(authority) };
            const connectConfig = {
                requestTimeout: this.config?.sessionTimeout,
                isEventStream,
            };
            const ref = useIsolatedSession
                ? this.connectionManager.createIsolatedSession(requestContext, connectConfig)
                : this.connectionManager.lease(requestContext, connectConfig);
            const session = ref.deref();
            const rejectWithDestroy = (err) => {
                if (useIsolatedSession) {
                    ref.destroy();
                }
                fulfilled = true;
                reject(err);
            };
            const queryString = query ? buildQueryString(query) : "";
            let path = request.path;
            if (queryString) {
                path += `?${queryString}`;
            }
            if (request.fragment) {
                path += `#${request.fragment}`;
            }
            const clientHttp2Stream = session.request({
                ...request.headers,
                [constants.HTTP2_HEADER_PATH]: path,
                [constants.HTTP2_HEADER_METHOD]: method,
            });
            if (effectiveRequestTimeout) {
                clientHttp2Stream.setTimeout(effectiveRequestTimeout, () => {
                    clientHttp2Stream.close();
                    const timeoutError = new Error(`Stream timed out because of no activity for ${effectiveRequestTimeout} ms`);
                    timeoutError.name = "TimeoutError";
                    rejectWithDestroy(timeoutError);
                });
            }
            if (abortSignal) {
                const onAbort = () => {
                    clientHttp2Stream.close();
                    const abortError = buildAbortError(abortSignal);
                    rejectWithDestroy(abortError);
                };
                if (typeof abortSignal.addEventListener === "function") {
                    const signal = abortSignal;
                    signal.addEventListener("abort", onAbort, { once: true });
                    clientHttp2Stream.once("close", () => signal.removeEventListener("abort", onAbort));
                }
                else {
                    abortSignal.onabort = onAbort;
                }
            }
            clientHttp2Stream.on("frameError", (type, code, id) => {
                rejectWithDestroy(new Error(`Frame type id ${type} in stream id ${id} has failed with code ${code}.`));
            });
            clientHttp2Stream.on("error", rejectWithDestroy);
            clientHttp2Stream.on("aborted", () => {
                rejectWithDestroy(new Error(`HTTP/2 stream is abnormally aborted in mid-communication with result code ${clientHttp2Stream.rstCode}.`));
            });
            clientHttp2Stream.on("response", (headers) => {
                const httpResponse = new HttpResponse({
                    statusCode: headers[":status"] ?? -1,
                    headers: getTransformedHeaders(headers),
                    body: clientHttp2Stream,
                });
                fulfilled = true;
                resolve({ response: httpResponse });
                if (useIsolatedSession) {
                    session.close();
                }
            });
            clientHttp2Stream.on("close", () => {
                if (useIsolatedSession) {
                    ref.destroy();
                }
                else {
                    this.connectionManager.release(requestContext, ref);
                }
                if (!fulfilled) {
                    rejectWithDestroy(new Error("Unexpected error: http2 request did not get a response"));
                }
            });
            writeRequestBodyPromise = writeRequestBody(clientHttp2Stream, request, effectiveRequestTimeout);
        });
    }
    updateHttpClientConfig(key, value) {
        this.config = undefined;
        this.configProvider = this.configProvider.then((config) => {
            return {
                ...config,
                [key]: value,
            };
        });
    }
    httpHandlerConfigs() {
        return this.config ?? {};
    }
}
