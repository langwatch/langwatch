import { type ComponentType, useEffect, useMemo, useRef, useState } from "react";
import { trace, type SpanOptions, type Attributes, type Span } from "@opentelemetry/api";
import { useOtelContext } from "./OtelContext";
import { SpanProvider } from "./SpanContext";

export interface WithSpanOptions {
  /**
   * Optional span options (e.g., attributes, links).
   */
  options?: SpanOptions;

  /**
   * Optional attributes to set on the span.
   * Can be a static object or a function that receives component props.
   */
  attributes?: Attributes | ((props: unknown) => Attributes);
}

/**
 * HOC that creates a span for the component's lifecycle.
 * Single Responsibility: Wrap a component to trace its mount/unmount and render its children in the span's context.
 *
 * The span is created on mount and ended on unmount.
 * All children render within the span's active context, so async operations inherit it.
 *
 * @param spanName - Name for the span
 * @param config - Optional configuration (span options, attributes)
 * @returns HOC function that wraps a component
 *
 * @example
 * ```tsx
 * // Page-level span
 * export default withSpan("View Simulation Batch")(SimulationBatchPage);
 *
 * // Component-level span
 * export const SimulationCard = withSpan("SimulationCard")(SimulationCardComponent);
 *
 * // With attributes
 * export const Card = withSpan("Card", {
 *   attributes: (props) => ({ cardId: props.id })
 * })(CardComponent);
 * ```
 */
export function withSpan<P extends Record<string, unknown>>(
  spanName: string,
  config?: WithSpanOptions
) {
  return function (Component: ComponentType<P>): ComponentType<P> {
    const Wrapped: ComponentType<P> = (props) => {
      const tracer = useMemo(() => trace.getTracer("react-client"), []);
      
      // Get lightweight context data (no network requests)
      const { contextData, setCurrentSpan } = useOtelContext();
      
      // Store span ref to keep it active throughout component lifecycle
      const spanRef = useRef<Span | null>(null);
      const [isSpanReady, setIsSpanReady] = useState(false);

      // Create span on mount, end on unmount
      useEffect(() => {
        const span = tracer.startSpan(spanName, config?.options);
        spanRef.current = span;
        setCurrentSpan(span);
        
        // Automatically set auth and context attributes from lightweight context
        if (contextData?.userId) {
          span.setAttribute("user.id", contextData.userId);
        }
        if (contextData?.userEmail) {
          span.setAttribute("user.email", contextData.userEmail);
        }
        if (contextData?.organizationId) {
          span.setAttribute("organization.id", contextData.organizationId);
        }
        if (contextData?.organizationName) {
          span.setAttribute("organization.name", contextData.organizationName);
        }
        if (contextData?.teamId) {
          span.setAttribute("team.id", contextData.teamId);
        }
        if (contextData?.teamName) {
          span.setAttribute("team.name", contextData.teamName);
        }
        if (contextData?.projectId) {
          span.setAttribute("project.id", contextData.projectId);
        }
        if (contextData?.projectSlug) {
          span.setAttribute("project.slug", contextData.projectSlug);
        }
        if (contextData?.projectName) {
          span.setAttribute("project.name", contextData.projectName);
        }

        // Set custom attributes if provided
        if (config?.attributes) {
          const attrs = typeof config.attributes === "function"
            ? config.attributes(props)
            : config.attributes;

          for (const [key, value] of Object.entries(attrs)) {
            span.setAttribute(key, value as never);
          }
        }
        
        setIsSpanReady(true);

        return () => {
          if (spanRef.current) {
            try {
              spanRef.current.end();
            } catch {
              // ignore
            }
          }
          setCurrentSpan(null);
          setIsSpanReady(false);
          spanRef.current = null;
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
      }, []);

      // Don't render until span is active
      if (!isSpanReady || !spanRef.current) {
        return null;
      }

      // Wrap component in SpanProvider to set active context
      // This ensures all async operations inherit this span as parent
      return (
        <SpanProvider span={spanRef.current}>
          <Component {...props} />
        </SpanProvider>
      );
    };

    Wrapped.displayName = `withSpan(${spanName})(${Component.displayName ?? Component.name ?? "Component"})`;
    return Wrapped;
  };
}

