import { createContext, type ReactNode, useContext, useMemo } from "react";

/**
 * How the trace surface is being viewed.
 *
 * In-app, the drawer reads its `traceId` from the drawer store and every
 * affordance is live. On the public `/share/<token>` page there is no drawer
 * store entry (seeding it would make `GlobalTraceV2DrawerMount` render a second
 * drawer over the page) and the viewer may be anonymous, so:
 *
 *   - `traceId` overrides the store, keeping the store untouched;
 *   - `isReadOnly` suppresses every affordance and query that needs a session.
 *
 * Read-only is a *rendering* concern only. It is not a security boundary — the
 * server authorizes each read against the share grant (ADR-057). Its job is to
 * stop the drawer firing authenticated queries that would 401 for a viewer who
 * legitimately holds a link.
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
  return (
    <TraceViewerContext.Provider value={value}>
      {children}
    </TraceViewerContext.Provider>
  );
}

/** Defaults to the live in-app drawer when no provider is mounted. */
export function useTraceViewer(): TraceViewer {
  return useContext(TraceViewerContext);
}

/** Convenience for the many hooks that only need to disable themselves. */
export function useIsReadOnlyTrace(): boolean {
  return useContext(TraceViewerContext).isReadOnly;
}
