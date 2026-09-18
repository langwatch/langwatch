import { ResponseTextConfig, type ParsedResponse, type ResponseCreateParamsBase, type ResponseStreamEvent } from "../../resources/responses/responses.mjs";
import { RequestOptions } from "../../internal/request-options.mjs";
import { type ReadableStream } from "../../internal/shim-types.mjs";
import OpenAI from "../../index.mjs";
import { type BaseEvents, EventStream } from "../EventStream.mjs";
import { type ResponseFunctionCallArgumentsDeltaEvent, type ResponseTextDeltaEvent } from "./EventTypes.mjs";
import { ParseableToolsParams } from "../ResponsesParser.mjs";
export type ResponseStreamParams = ResponseCreateAndStreamParams | ResponseStreamByIdParams;
export type ResponseCreateAndStreamParams = Omit<ResponseCreateParamsBase, 'stream'> & {
    stream?: true;
};
export type ResponseStreamByIdParams = {
    /**
     * The ID of the response to stream.
     */
    response_id: string;
    /**
     * If provided, events with a sequence number less than or equal to this value
     * will not be emitted. The helper still replays them internally to build a
     * complete snapshot for later events and `finalResponse()`.
     */
    starting_after?: number;
    /**
     * Configuration options for a text response from the model. Can be plain text or
     * structured JSON data. Learn more:
     *
     * - [Text inputs and outputs](https://platform.openai.com/docs/guides/text)
     * - [Structured Outputs](https://platform.openai.com/docs/guides/structured-outputs)
     */
    text?: ResponseTextConfig;
    /**
     * An array of tools the model may call while generating a response. When continuing a stream, provide
     * the same tools as the original request.
     */
    tools?: ParseableToolsParams;
};
type ResponseEvents = BaseEvents & Omit<{
    [K in ResponseStreamEvent['type']]: (event: Extract<ResponseStreamEvent, {
        type: K;
    }>) => void;
}, 'response.output_text.delta' | 'response.function_call_arguments.delta'> & {
    event: (event: ResponseStreamEvent) => void;
    'response.output_text.delta': (event: ResponseTextDeltaEvent) => void;
    'response.function_call_arguments.delta': (event: ResponseFunctionCallArgumentsDeltaEvent) => void;
};
export type ResponseStreamingParams = Omit<ResponseCreateParamsBase, 'stream'> & {
    stream?: true;
};
export declare class ResponseStream<ParsedT = null> extends EventStream<ResponseEvents> implements AsyncIterable<ResponseStreamEvent> {
    #private;
    constructor(params: ResponseStreamingParams | null);
    static createResponse<ParsedT>(client: OpenAI, params: ResponseStreamParams, options?: RequestOptions): ResponseStream<ParsedT>;
    static fromReadableStream(stream: ReadableStream): ResponseStream<null>;
    protected _createOrRetrieveResponse(client: OpenAI, params: ResponseStreamParams, options?: RequestOptions): Promise<ParsedResponse<ParsedT>>;
    protected _fromReadableStream(readableStream: ReadableStream, options?: RequestOptions): Promise<ParsedResponse<ParsedT>>;
    [Symbol.asyncIterator](this: ResponseStream<ParsedT>): AsyncIterator<ResponseStreamEvent>;
    /**
     * @returns a promise that resolves with the final Response, or rejects
     * if an error occurred or the stream ended prematurely without producing a REsponse.
     */
    finalResponse(): Promise<ParsedResponse<ParsedT>>;
}
export {};
//# sourceMappingURL=ResponseStream.d.mts.map