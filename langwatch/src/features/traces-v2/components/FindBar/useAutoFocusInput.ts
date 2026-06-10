import { type RefObject, useEffect, useRef } from "react";

export function useAutoFocusInput(
  active: boolean,
): RefObject<HTMLInputElement | null> {
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!active) return;
    const handle = requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    });
    return () => cancelAnimationFrame(handle);
  }, [active]);

  return inputRef;
}
