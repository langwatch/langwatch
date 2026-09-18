import type { BuildMiddleware } from "@smithy/types";
/**
 * Used for two Lambda-related responsibilities:
 * - Inject to trace ID to request header to detect recursion invocation in Lambda.
 * - Propagate W3C trace context headers from
 *   the Lambda InvokeStore onto outbound requests, enabling distributed trace
 *   context to flow to downstream calls without creating any spans.
 * @internal
 */
export declare const recursionDetectionMiddleware: () => BuildMiddleware<any, any>;
