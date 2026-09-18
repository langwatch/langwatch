import type { ClientHttp2Stream } from "node:http2";
import type { IncomingMessage } from "node:http";
import type { InvokeMethod } from "../client";
import type { GetOutputType } from "../command";
import type { HttpHandlerOptions } from "../http";
import type { SdkStream } from "../serde";
import type { BrowserRuntimeStreamingBlobPayloadInputTypes, NodeJsRuntimeStreamingBlobPayloadInputTypes, StreamingBlobPayloadInputTypes } from "../streaming-payload/streaming-blob-payload-input-types";
import type { StreamingBlobPayloadOutputTypes } from "../streaming-payload/streaming-blob-payload-output-types";
import type { NarrowedInvokeMethod } from "./client-method-transforms";
import type { Transform } from "./type-transform";
/**
 * Creates a type with a given client type that narrows payload blob output
 * types to SdkStream<IncomingMessage>.
 * This can be used for clients with the NodeHttpHandler requestHandler,
 * the default in Node.js when not using HTTP2.
 * Usage example:
 * ```typescript
 * const client = new YourClient({}) as NodeJsClient<YourClient>;
 * ```
 *
 * @public
 */
export type NodeJsClient<ClientType extends object> = NarrowPayloadBlobTypes<NodeJsRuntimeStreamingBlobPayloadInputTypes, SdkStream<IncomingMessage>, ClientType>;
/**
 * Variant of NodeJsClient for node:http2.
 *
 * @public
 */
export type NodeJsHttp2Client<ClientType extends object> = NarrowPayloadBlobTypes<NodeJsRuntimeStreamingBlobPayloadInputTypes, SdkStream<ClientHttp2Stream>, ClientType>;
/**
 * Creates a type with a given client type that narrows payload blob output
 * types to SdkStream<ReadableStream>.
 * This can be used for clients with the FetchHttpHandler requestHandler,
 * which is the default in browser environments.
 * Usage example:
 * ```typescript
 * const client = new YourClient({}) as BrowserClient<YourClient>;
 * ```
 *
 * @public
 */
export type BrowserClient<ClientType extends object> = NarrowPayloadBlobTypes<BrowserRuntimeStreamingBlobPayloadInputTypes, SdkStream<ReadableStream>, ClientType>;
/**
 * Variant of BrowserClient for XMLHttpRequest.
 *
 * @public
 */
export type BrowserXhrClient<ClientType extends object> = NarrowPayloadBlobTypes<BrowserRuntimeStreamingBlobPayloadInputTypes, SdkStream<ReadableStream | Blob>, ClientType>;
/**
 * Narrow a given Client's blob payload outputs to the given type T.
 *
 * @public
 * @deprecated use NarrowPayloadBlobTypes<I, O, ClientType>.
 */
export type NarrowPayloadBlobOutputType<T, ClientType extends object> = {
    [key in keyof ClientType]: [ClientType[key]] extends [
        InvokeMethod<infer FunctionInputTypes, infer FunctionOutputTypes>
    ] ? NarrowedInvokeMethod<T, HttpHandlerOptions, FunctionInputTypes, FunctionOutputTypes> : ClientType[key];
} & {
    send<Command>(command: Command, options?: any): Promise<Transform<GetOutputType<Command>, StreamingBlobPayloadOutputTypes | undefined, T>>;
};
/**
 * Narrow a Client's blob payload input and output types to I and O.
 *
 * @public
 */
export type NarrowPayloadBlobTypes<I, O, ClientType extends object> = {
    [key in keyof ClientType]: [ClientType[key]] extends [
        InvokeMethod<infer FunctionInputTypes, infer FunctionOutputTypes>
    ] ? NarrowedInvokeMethod<O, HttpHandlerOptions, Transform<FunctionInputTypes, StreamingBlobPayloadInputTypes | undefined, I>, FunctionOutputTypes> : ClientType[key];
} & {
    send<Command>(command: Command, options?: any): Promise<Transform<GetOutputType<Command>, StreamingBlobPayloadOutputTypes | undefined, O>>;
};
