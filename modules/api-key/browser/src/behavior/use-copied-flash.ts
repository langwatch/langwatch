import { useEffect, useRef, useState } from "react";

const FLASH_MS = 2000;

/** A "copied" tick that clears itself after two seconds, and never fires after unmount. */
export function useCopiedFlash(): { copied: boolean; flash: () => void } {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  const flash = () => {
    clearTimeout(timer.current);
    setCopied(true);
    timer.current = setTimeout(() => setCopied(false), FLASH_MS);
  };
  return { copied, flash };
}
