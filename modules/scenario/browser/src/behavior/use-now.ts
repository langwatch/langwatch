import { nowInstant } from "@langwatch/time";
/**
 * Returns the current time, updating every minute via NowProvider.
 */
import { createContext, useContext } from "react";

export const NowContext = createContext<number>(nowInstant().epochMilliseconds);

/**
 * Returns the current time from the nearest `NowProvider`.
 * Falls back to a static `Date.now()` if no provider is present.
 */
export function useNow(): number {
  return useContext(NowContext);
}
