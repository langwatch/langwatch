import { createContext, useContext, type RefObject } from "react";

type ScrollRef = RefObject<HTMLElement | null> | null;

export const TraceTableScrollContext = createContext<ScrollRef>(null);

export function useTraceTableScrollRef(): RefObject<HTMLElement | null> {
  const ref = useContext(TraceTableScrollContext);
  if (!ref) {
    throw new Error(
      "useTraceTableScrollRef must be used inside TraceTableLayout",
    );
  }
  return ref;
}
