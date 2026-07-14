import { useEffect } from "react";

export function useScrollTraceIntoView(traceId: string | null): void {
  useEffect(() => {
    if (!traceId) return;
    const el = document.querySelector(
      `[data-trace-id="${CSS.escape(traceId)}"]`,
    );
    el?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [traceId]);
}
