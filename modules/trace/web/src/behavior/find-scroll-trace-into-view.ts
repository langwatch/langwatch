import { useEffect } from "react";

export function useFindScrollTraceIntoView(traceId: string | null): void {
  useEffect(() => {
    if (!traceId) return;
    const element = document.querySelector(`[data-trace-id="${CSS.escape(traceId)}"]`);
    element?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [traceId]);
}
