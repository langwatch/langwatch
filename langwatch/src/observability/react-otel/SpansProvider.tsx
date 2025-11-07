import { type FC, type PropsWithChildren, useCallback, useEffect, useRef } from "react";
import { trace, type Span, type SpanOptions } from "@opentelemetry/api";
import { SpansContext, type SpanName } from "./SpansContext";

/**
 * SpansProvider stores and manages spans keyed by name for the React app.
 * Single Responsibility: Provide a simple API to create/end named spans without leaking tracing logic into components.
 */
const SpansProvider: FC<PropsWithChildren> = ({ children }) => {
  const spansRef = useRef<Map<SpanName, Span>>(new Map());

  const getOrCreateSpan = useCallback(
    (name: SpanName, options?: SpanOptions): [Span, boolean] => {
      const existing = spansRef.current.get(name);
      if (existing) {
        return [existing, false];
      }

      const tracer = trace.getTracer("react-client");
      const span = tracer.startSpan(name, options);
      spansRef.current.set(name, span);
      return [span, true];
    },
    []
  );

  const endSpan = useCallback((name: SpanName) => {
    const span = spansRef.current.get(name);
    if (span) {
      span.end();
      spansRef.current.delete(name);
    }
  }, []);

  // Ensure any remaining spans are ended when the provider unmounts
  useEffect(() => {
    return () => {
      const spans = spansRef.current;
      for (const [name, span] of spans.entries()) {
        try {
          span.end();
        } catch {
          // ignore
        } finally {
          spans.delete(name);
        }
      }
    };
  }, []);

  return (
    <SpansContext.Provider value={{ getOrCreateSpan, endSpan }}>
      {children}
    </SpansContext.Provider>
  );
};

export default SpansProvider;
