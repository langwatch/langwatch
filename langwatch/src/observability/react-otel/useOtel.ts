import { useMemo } from "react";
import { trace, type Attributes } from "@opentelemetry/api";

/**
 * Hook for accessing OTel tracing operations.
 * Single Responsibility: Provide convenient access to tracing operations that work with the active span context.
 * 
 * @example
 * ```tsx
 * const { addEvent } = useOtel();
 * 
 * // Add event to current active span
 * addEvent("Button Clicked", { buttonId: "submit" });
 * ```
 */
export function useOtel() {
  const tracer = useMemo(() => trace.getTracer("react-client"), []);

  const helpers = useMemo(() => {
    /**
     * Add an event to the currently active span.
     * Uses trace.getActiveSpan() to get the current span from Zone context.
     */
    function addEvent(eventName: string, attributes?: Attributes) {
      const activeSpan = trace.getActiveSpan();
      activeSpan?.addEvent(eventName, attributes);
    }

    /**
     * Set attributes on the currently active span.
     * Uses trace.getActiveSpan() to get the current span from Zone context.
     */
    function setAttributes(attributes: Attributes) {
      const activeSpan = trace.getActiveSpan();
      if (activeSpan) {
        for (const [key, value] of Object.entries(attributes)) {
          activeSpan.setAttribute(key, value as never);
        }
      }
    }

    return { addEvent, setAttributes };
  }, [tracer]);

  return helpers;
}

