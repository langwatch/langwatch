import { useEffect, useRef, useState } from "react";

import { docsSessionMode } from "../../../config.ts";
import { createDocsSession } from "../model/session-config.ts";
import type { DocsSessionController, SessionView } from "../model/session-controller.ts";
import { DocsSessionError } from "../model/token-provider.ts";

export function useDocsSession() {
  const [controller] = useState(() => createDocsSession({ mode: docsSessionMode }));
  const [selected, setSelected] = useState(false);
  const [view, setView] = useState<SessionView>({ kind: "disconnected" });
  const pending = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!controller) return;
    const checkExpiry = () => {
      const next = controller.snapshot();
      if (next.kind === "expired") setView(next);
    };
    const clear = () => {
      pending.current?.abort();
      void controller.disconnect().catch(() => {});
    };
    const timer = window.setInterval(checkExpiry, 1000);
    window.addEventListener("focus", checkExpiry);
    const leavePage = () => {
      clear();
      setSelected(false);
      setView({ kind: "disconnected" });
    };
    window.addEventListener("pagehide", leavePage);
    return () => {
      clear();
      window.clearInterval(timer);
      window.removeEventListener("focus", checkExpiry);
      window.removeEventListener("pagehide", leavePage);
    };
  }, [controller]);

  const connect = async () => {
    if (!controller) return;
    pending.current?.abort();
    const attempt = new AbortController();
    pending.current = attempt;
    setSelected(true);
    setView({ kind: "connecting" });
    const next = await connectSession({ controller, signal: attempt.signal });
    if (!attempt.signal.aborted) setView(next);
  };

  const disconnect = async () => {
    pending.current?.abort();
    setSelected(false);
    setView({ kind: "disconnected" });
    try {
      await controller?.disconnect();
    } catch {
      setView({ kind: "error", message: "Cleared in this tab. Could not confirm revocation." });
    }
  };

  return { controller, selected, view, connect, disconnect };
}

async function connectSession({
  controller,
  signal,
}: {
  controller: DocsSessionController;
  signal: AbortSignal;
}): Promise<SessionView> {
  try {
    await controller.connect({ signal });
    return controller.snapshot();
  } catch (error) {
    return {
      kind: "error",
      message: error instanceof DocsSessionError ? error.message : "Could not connect. Try again.",
    };
  }
}
