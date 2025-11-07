import { createContext, useContext } from "react";
import type { Span, SpanOptions } from "@opentelemetry/api";

export type SpanName = string;

export interface SpansContextValue {
  getOrCreateSpan: (
    name: SpanName,
    options?: SpanOptions
  ) => [Span, boolean];
  endSpan: (name: SpanName) => void;
}

const missingProviderMessage =
  "SpansProvider is missing in the React tree. Wrap your app with SpansProvider.";

export const SpansContext = createContext<SpansContextValue | null>(null);

export function useSpansContext(): SpansContextValue {
  const context = useContext(SpansContext);
  if (!context) {
    throw new Error(missingProviderMessage);
  }
  return context;
}

