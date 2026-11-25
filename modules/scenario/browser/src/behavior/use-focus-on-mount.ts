import { useEffect, useRef, useState } from "react";

/** A ref whose element takes focus once, when it mounts, if it should. */
export function useFocusOnMount<Element extends HTMLElement>(shouldFocus = true) {
  const ref = useRef<Element>(null);
  const [focusOnMount] = useState(shouldFocus);

  useEffect(() => {
    if (focusOnMount) ref.current?.focus();
  }, [focusOnMount]);

  return ref;
}
