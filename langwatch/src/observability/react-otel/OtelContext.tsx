import { createContext, useContext } from "react";
import { type Span } from "@opentelemetry/api";

/**
 * Lightweight context data captured once at app level.
 * Single Responsibility: Store auth/org/team/project data for span enrichment without repeated network calls.
 */
export interface OtelContextData {
  userId?: string;
  userEmail?: string;
  organizationId?: string;
  organizationName?: string;
  teamId?: string;
  teamName?: string;
  projectId?: string;
  projectSlug?: string;
  projectName?: string;
}

/**
 * OTel React context interface.
 * Single Responsibility: Provide access to current active span and lightweight context data.
 */
export interface OtelContextValue {
  currentSpan: Span | null;
  setCurrentSpan: (span: Span | null) => void;
  contextData?: OtelContextData;
}

const missingProviderMessage =
  "OtelProvider is missing in the React tree. Wrap your app with OtelProvider.";

export const OtelContext = createContext<OtelContextValue | null>(null);

export function useOtelContext(): OtelContextValue {
  const context = useContext(OtelContext);
  if (!context) {
    throw new Error(missingProviderMessage);
  }

  return { ...context };
}
