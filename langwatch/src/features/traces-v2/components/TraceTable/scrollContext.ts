import { type RefObject, useEffect } from "react";

/**
 * Module-level holder for the trace-table scroll container ref. Avoids
 * React Context (banned by traces-v2 STANDARDS §2) while still letting
 * children (the virtualizer + new-traces indicator) reach the same DOM
 * element established by `TraceTableLayout`.
 *
 * Rendering two trace tables on the same page would race on this ref;
 * we don't do that today and it would be obvious in code review.
 */
let currentScrollRef: RefObject<HTMLElement | null> | null = null;

export function useTraceTableScrollRef(): RefObject<HTMLElement | null> {
  if (!currentScrollRef) {
    throw new Error(
      "useTraceTableScrollRef must be used inside TraceTableLayout",
    );
  }
  return currentScrollRef;
}

/**
 * Layout-side hook — registers the scroll ref *synchronously during render*
 * so descendants reading via `useTraceTableScrollRef()` see it on the same
 * render pass. A `useEffect` cleanup clears the holder on unmount.
 *
 * Setting state during render is unusual but safe here: the holder is a
 * module-level mutable pointer to a stable React ref, not React state, and
 * the Layout always renders before its children.
 */
export function useRegisterTraceTableScrollRef(
  ref: RefObject<HTMLElement | null>,
): void {
  currentScrollRef = ref;
  useEffect(() => {
    currentScrollRef = ref;
    return () => {
      if (currentScrollRef === ref) currentScrollRef = null;
    };
  }, [ref]);
}
