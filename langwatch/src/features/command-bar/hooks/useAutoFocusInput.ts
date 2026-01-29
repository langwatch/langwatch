import { useEffect } from "react";

/**
 * Hook that auto-focuses the input when the dialog opens.
 */
export function useAutoFocusInput(
  isOpen: boolean,
  inputRef: React.RefObject<HTMLInputElement | null>
) {
  useEffect(() => {
    if (isOpen) {
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [isOpen, inputRef]);
}
