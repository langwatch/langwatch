import { createContext, type ReactNode, useContext, useMemo } from "react";

/**
 * How the trace surface is being viewed.
 */
export interface TraceViewer {
  /** Overrides `drawerStore.traceId` when set. */
  traceId?: string;
  isReadOnly: boolean;
}

const TraceViewerContext = createContext<TraceViewer>({ isReadOnly: false });

export function TraceViewerProvider({
  traceId,
  isReadOnly,
  children,
}: TraceViewer & { children: ReactNode }) {
  const value = useMemo(() => ({ traceId, isReadOnly }), [traceId, isReadOnly]);
  return <TraceViewerContext.Provider value={value}>{children}</TraceViewerContext.Provider>;
}

/** Defaults to the live in-app drawer when no provider is mounted. */
export function useTraceViewer(): TraceViewer {
  return useContext(TraceViewerContext);
}

/** Convenience for the many hooks that only need to disable themselves. */
export function useIsReadOnlyTrace(): boolean {
  return useContext(TraceViewerContext).isReadOnly;
}
