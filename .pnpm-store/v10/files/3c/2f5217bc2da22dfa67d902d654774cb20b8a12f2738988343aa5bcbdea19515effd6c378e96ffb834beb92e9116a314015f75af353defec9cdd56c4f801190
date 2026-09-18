import { type Response, type ResponseStreamEvent } from "../../resources/responses/responses.mjs";
type ResponseKeepAliveEvent = {
    type: 'keepalive';
    sequence_number: number;
};
/**
 * Applies a streaming event to a response snapshot.
 *
 * Always use the returned snapshot. Incremental events update the supplied snapshot
 * in place, while response lifecycle events return a detached replacement. Event
 * payloads are cloned, so retaining or replaying the raw events is safe.
 */
export declare function accumulateResponse(event: ResponseStreamEvent | ResponseKeepAliveEvent, snapshot?: Response): Response;
export {};
//# sourceMappingURL=ResponseAccumulator.d.mts.map