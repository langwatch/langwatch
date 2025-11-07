import { useMemo } from "react";
import { context, trace, type Attributes, SpanStatusCode } from "@opentelemetry/api";
import { useSpansContext } from "./SpansContext";

/**
 * Hook to access spans context with ergonomic helpers.
 * Single Responsibility: Provide utilities to interact with named spans.
 */
export function useSpans() {
  const { getOrCreateSpan, endSpan } = useSpansContext();

  const helpers = useMemo(() => {
    function addEvent(name: string, eventName: string, attributes?: Attributes) {
      const [span] = getOrCreateSpan(name);
      span.addEvent(eventName, attributes);
      return span;
    }

    function setAttributes(name: string, attributes: Attributes) {
      const [span] = getOrCreateSpan(name);
      for (const [key, value] of Object.entries(attributes)) {
        span.setAttribute(key, value as never);
      }
      return span;
    }

    function setOk(name: string) {
      const [span] = getOrCreateSpan(name);
      span.setStatus({ code: SpanStatusCode.OK });
      return span;
    }

    function runInSpanContext<TResult>(
      name: string,
      fn: () => TResult
    ): TResult {
      const [span] = getOrCreateSpan(name);
      const parentCtx = trace.setSpan(context.active(), span);
      return context.with(parentCtx, fn);
    }

    return { addEvent, setAttributes, setOk, runInSpanContext };
  }, [getOrCreateSpan]);

  return { getOrCreateSpan, endSpan, ...helpers };
}

export { useSpansContext } from "./SpansContext";
