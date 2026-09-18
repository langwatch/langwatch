import { InvokeStore } from "@aws/lambda-invoke-store";
import { HttpRequest } from "@smithy/core/protocols";
const AWS_LAMBDA_FUNCTION_NAME = "AWS_LAMBDA_FUNCTION_NAME";
const _X_AMZN_TRACE_ID = "_X_AMZN_TRACE_ID";
const X_AMZN_TRACE_ID = "X-Amzn-Trace-Id";
const TRACEPARENT = "traceparent";
const TRACESTATE = "tracestate";
const BAGGAGE = "baggage";
export const recursionDetectionMiddleware = () => (next) => async (args) => {
    const { request } = args;
    if (!HttpRequest.isInstance(request)) {
        return next(args);
    }
    let invokeStore;
    {
        const traceIdHeader = Object.keys(request.headers ?? {}).find((h) => h.toLowerCase() === X_AMZN_TRACE_ID.toLowerCase()) ??
            X_AMZN_TRACE_ID;
        if (!request.headers.hasOwnProperty(traceIdHeader)) {
            const functionName = process.env[AWS_LAMBDA_FUNCTION_NAME];
            const traceIdFromEnv = process.env[_X_AMZN_TRACE_ID];
            invokeStore ??= await InvokeStore.getInstanceAsync();
            const traceIdFromInvokeStore = invokeStore?.getXRayTraceId();
            const traceId = traceIdFromInvokeStore ?? traceIdFromEnv;
            const nonEmptyString = (str) => typeof str === "string" && str.length > 0;
            if (nonEmptyString(functionName) && nonEmptyString(traceId)) {
                request.headers[X_AMZN_TRACE_ID] = traceId;
            }
        }
    }
    {
        sanitizeTraceHeaders(request.headers);
        const existingTraceparent = request.headers[TRACEPARENT];
        if (!existingTraceparent) {
            const traceparent = (invokeStore ??= await InvokeStore.getInstanceAsync())?.getTraceparent?.();
            if (traceparent) {
                request.headers[TRACEPARENT] = traceparent;
                const tracestate = invokeStore?.getTracestate?.();
                if (tracestate) {
                    request.headers[TRACESTATE] = tracestate;
                }
                const baggage = invokeStore?.getBaggage?.();
                if (baggage) {
                    request.headers[BAGGAGE] = baggage;
                }
            }
        }
    }
    return next(args);
};
function sanitizeTraceHeaders(headers) {
    for (const header of Object.keys(headers)) {
        const lower = header.toLowerCase();
        if (header !== lower && (lower === TRACEPARENT || lower === TRACESTATE || lower === BAGGAGE)) {
            headers[lower] = headers[header];
            delete headers[header];
        }
    }
}
