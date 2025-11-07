import { createContext, useContext, type ReactNode } from "react";
import { context, trace, type Span } from "@opentelemetry/api";

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
export function SpanProvider({ span, children }: { span: Span; children: ReactNode }) {
  // Set this span as the active span in the OpenTelemetry context
  // This is picked up by the ZoneContextManager
  const ctx = trace.setSpan(context.active(), span);
  
  // Render children within this context
  // All async operations started from children will inherit this span
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

