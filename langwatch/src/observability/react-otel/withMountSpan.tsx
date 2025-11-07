import { type ComponentType, createElement, useEffect } from "react";
import { type SpanOptions } from "@opentelemetry/api";
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

    useEffect(() => {
      const [, created] = getOrCreateSpan(spanName, options);
      if (created) {
        const attrs =
          typeof attributes === "function" ? attributes(props) : attributes;
        if (attrs) {
          setAttributes(spanName, attrs);
        }
      }
      return () => {
        endSpan(spanName);
      };
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    return createElement(Component, props);
  };

  Wrapped.displayName = `WithMountSpan(${Component.displayName ?? Component.name ?? "Component"})`;
  return Wrapped;
}
