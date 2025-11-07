import { type ComponentType, createElement, useEffect, useMemo } from "react";
import { context, trace, type SpanOptions } from "@opentelemetry/api";
import { useSpans } from "./useSpans";
import type { Attributes } from "@opentelemetry/api";

export interface WithMountSpanOptions<P> {
  spanName: string;
  options?: SpanOptions;
  attributes?: Attributes | ((props: P) => Attributes);
}

/**
 * HOC that starts a span on mount and ends it on unmount.
 * Single Responsibility: Bind component lifecycle to a named span.
 */
export function withMountSpan<P extends Record<string, unknown>>(
  Component: ComponentType<P>,
  { spanName, options, attributes }: WithMountSpanOptions<P>
) {
  const Wrapped: ComponentType<P> = (props) => {
    const { getOrCreateSpan, setAttributes, endSpan } = useSpans();

    // Ensure span exists and attributes are set once on mount; end on unmount
    useEffect(() => {
      const [, created] = getOrCreateSpan(spanName, options);
      if (created) {
        const attrs =
          typeof attributes === "function" ? attributes(props) : attributes;
        if (attrs) setAttributes(spanName, attrs);
      }
      return () => endSpan(spanName);
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // Render subtree inside the span's active context so async work (fetch/XHR)
    // auto-instrumentation links as children of this span.
    const element = useMemo(() => {
      const [span] = getOrCreateSpan(spanName, options);
      const ctx = trace.setSpan(context.active(), span);
      let rendered: ReturnType<typeof createElement> | null = null;
      context.with(ctx, () => {
        rendered = createElement(Component, props);
      });
      return rendered!;
      // re-evaluate when props change so new callbacks are bound to context
    }, [Component, getOrCreateSpan, options, props]);

    return element;
  };

  Wrapped.displayName = `WithMountSpan(${Component.displayName ?? Component.name ?? "Component"})`;
  return Wrapped;
}
