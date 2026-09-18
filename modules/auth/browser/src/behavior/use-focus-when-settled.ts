import { type RefObject, useEffect, useRef } from "react";
import { useEntranceSettled } from "../model/entrance.ts";

/**
 * Focus after entrance settles; withheld from first paint and reduced-motion
 */
export function useFocusWhenSettled(): RefObject<HTMLInputElement | null> {
  const field = useRef<HTMLInputElement>(null);
  const settled = useEntranceSettled();

  useEffect(() => {
    if (settled) field.current?.focus();
  }, [settled]);

  return field;
}
