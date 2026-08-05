/**
 * Returns the current time, updating every minute via NowProvider.
 *
 * Use this to keep relative time labels ("2m ago", "1h ago") fresh
 * without requiring a data refetch.
 *
 * Wrap a subtree with `<NowProvider>` (from NowProvider.tsx) to share
 * a single timer across all descendants. Without a provider, `useNow()`
 * falls back to `Date.now()` (static, no ticking).
 */
import { createContext, useContext } from "react";

export const NowContext = createContext<number>(Date.now());

/**
 * Returns the current time from the nearest `NowProvider`.
 * Falls back to a static `Date.now()` if no provider is present.
 */
export function useNow(): number {
  return useContext(NowContext);
}
