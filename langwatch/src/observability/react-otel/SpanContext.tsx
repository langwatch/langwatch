import { createContext, useContext, type ReactNode } from "react";
import { context, trace, type Span, type Context } from "@opentelemetry/api";

/**
 * React context that provides the active OpenTelemetry span.
 * This allows child components to access the parent span for creating child spans.
 */
const SpanContext = createContext<Span | null>(null);

export function useParentSpan(): Span | null {
  return useContext(SpanContext);
}

/**
 * Provider that makes a span available to all child components.
 * Child operations (fetch, XHR) will automatically use this span as parent
 * thanks to the ZoneContextManager and auto-instrumentation.
 */
export function SpanProvider({
  span,
  parentContext,
  children,
}: {
  span: Span;
  parentContext?: Context;
  children: ReactNode;
}) {
  // Use provided parent context when available to preserve proper span hierarchy.
  const ctx = trace.setSpan(parentContext ?? context.active(), span);

  // Render children within this context to propagate the active span.
  let rendered: ReactNode = null;
  context.with(ctx, () => {
    rendered = (
      <SpanContext.Provider value={span}>
        {children}
      </SpanContext.Provider>
    );
  });

  return <>{rendered}</>;
}
