import { useEffect, useRef, useState } from "react";

export type CopyState = "idle" | "copied" | "failed";
const RESET_MS = 2000;

export async function writeClipboard({ text }: { text: string }): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

/** Copy action state: idle, copied for two seconds, or failed. */
export function useCopy() {
  const [state, setState] = useState<CopyState>("idle");
  const [ready, setReady] = useState(false);
  const timer = useRef<number | undefined>(void 0);
  useEffect(() => {
    setReady(true);
    return () => window.clearTimeout(timer.current);
  }, []);
  const copy = async ({ text }: { text: string | (() => Promise<string>) }) => {
    window.clearTimeout(timer.current);
    let ok = false;
    try {
      ok = await writeClipboard({ text: typeof text === "string" ? text : await text() });
    } catch {
      ok = false;
    }
    setState(ok ? "copied" : "failed");
    timer.current = window.setTimeout(() => setState("idle"), RESET_MS);
  };
  return { state, copy, ready };
}
