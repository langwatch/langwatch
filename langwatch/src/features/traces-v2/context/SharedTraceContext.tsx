import { createContext, useContext, type ReactNode } from "react";
import type { RouterOutputs } from "~/utils/api";

/**
 * The one payload behind the read-only share page. The share page resolves the
 * token once via `sharedTrace.get` and puts the result here; the per-trace
 * drawer hooks (`useTraceHeader`, `useSpanTree`, …) read their slice from this
 * context instead of firing their own `protectedProcedure` reads, which would
 * 401 for an anonymous viewer. When the context is absent (the normal in-app
 * drawer), the hooks fetch as usual. See ADR-057.
 */
export type SharedTraceData = RouterOutputs["sharedTrace"]["get"];

const SharedTraceContext = createContext<SharedTraceData | null>(null);

export function SharedTraceProvider({
  value,
  children,
}: {
  value: SharedTraceData;
  children: ReactNode;
}) {
  return (
    <SharedTraceContext.Provider value={value}>
      {children}
    </SharedTraceContext.Provider>
  );
}

/** The shared payload when rendering inside the share page, else null. */
export function useSharedTrace(): SharedTraceData | null {
  return useContext(SharedTraceContext);
}

/**
 * Wrap a per-trace hook's return in share mode: a settled, successful
 * query-result shape carrying the shared slice. Cast through `unknown` because
 * the drawer hooks only read `data` / `isLoading` / `error` off these results.
 */
export function asSharedQueryResult<T>(data: T): {
  data: T;
  isLoading: false;
  isFetching: false;
  isError: false;
  isSuccess: true;
  error: null;
  refetch: () => Promise<void>;
} {
  return {
    data,
    isLoading: false,
    isFetching: false,
    isError: false,
    isSuccess: true,
    error: null,
    refetch: async () => undefined,
  };
}
