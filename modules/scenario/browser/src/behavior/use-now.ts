import { nowInstant } from "@langwatch/time";
import { createContext, useContext } from "react";

export const NowContext = createContext<number>(nowInstant().epochMilliseconds);

/**
 * Returns the current time from the nearest `NowProvider`, which ticks it.
 * Falls back to the module-load time if no provider is present.
 */
export function useNow(): number {
  return useContext(NowContext);
}
