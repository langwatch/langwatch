import { context, trace, type Attributes, type Span } from "@opentelemetry/api";
import { useSpans } from "./useSpans";
import { useMemo } from "react";

/**
 * React hook returning a function to wrap callbacks and record an event on a named span.
 * Single Responsibility: Provide an easy way to add events around handlers.
 */
export function useTraceEvent(spanName: string) {
  const { getOrCreateSpan } = useSpans();

  return useMemo(() => {
    return function traceEvent<TArgs extends unknown[], TResult>(
      childSpanName: string,
      handler: (...args: TArgs) => TResult,
      toAttributes?: (...args: TArgs) => Attributes | undefined
    ) {
      return (...args: TArgs) => {
        const [parentSpan] = getOrCreateSpan(spanName);
        const tracer = trace.getTracer("react-client");
        const ctx = trace.setSpan(context.active(), parentSpan);
        return tracer.startActiveSpan(
          childSpanName,
          {},
          ctx,
          (child: Span) => {
            try {
              const attrs = toAttributes ? toAttributes(...args) : undefined;
              if (attrs) {
                for (const [k, v] of Object.entries(attrs)) {
                  child.setAttribute(k, v as never);
                }
              }
              const result = handler(...args) as unknown;
              if (
                result &&
                typeof (result as Promise<unknown>).then === "function"
              ) {
                return (result as Promise<unknown>)
                  .finally(() => {
                    try { child.end(); } catch {}
                  }) as unknown as TResult;
              }
              return result as TResult;
            } finally {
              try { child.end(); } catch {}
            }
          }
        );
      };
    };
  }, [getOrCreateSpan, spanName]);
}
