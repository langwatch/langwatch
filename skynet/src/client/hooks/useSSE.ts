import { useEffect, useRef, useState, useCallback } from "react";
import { SSE_RECYCLE_INTERVAL_MS } from "../../shared/constants.ts";

export type ConnectionStatus = "connecting" | "connected" | "disconnected";

interface UseSSEOptions {
  url: string;
  onEvent: (event: string, data: unknown) => void;
}

export function useSSE({ url, onEvent }: UseSSEOptions) {
  const [status, setStatus] = useState<ConnectionStatus>("connecting");
  const onEventRef = useRef(onEvent);
  onEventRef.current = onEvent;
  const retryDelay = useRef(1000);

  useEffect(() => {
    let es: EventSource | null = null;
    let dead = false;
    let recycleTimer: ReturnType<typeof setTimeout> | null = null;

    function connect() {
      if (dead) return;
      setStatus("connecting");
      es = new EventSource(url);

      es.onopen = () => {
        setStatus("connected");
        retryDelay.current = 1000;

        // Periodically close and reconnect to release buffered response data
        // in the browser's network layer (prevents tab crashes after ~15min)
        recycleTimer = setTimeout(() => {
          if (!dead && es) {
            es.close();
            connect();
          }
        }, SSE_RECYCLE_INTERVAL_MS);
      };

      es.addEventListener("dashboard", (e) => {
        try {
          onEventRef.current("dashboard", JSON.parse(e.data));
        } catch { /* ignore */ }
      });

      es.addEventListener("heartbeat", (e) => {
        try {
          onEventRef.current("heartbeat", JSON.parse(e.data));
        } catch { /* ignore */ }
      });

      es.onerror = () => {
        setStatus("disconnected");
        es?.close();
        if (recycleTimer) {
          clearTimeout(recycleTimer);
          recycleTimer = null;
        }
        const delay = Math.min(retryDelay.current, 30000);
        retryDelay.current = delay * 1.5;
        setTimeout(connect, delay);
      };
    }

    connect();

    return () => {
      dead = true;
      if (recycleTimer) {
        clearTimeout(recycleTimer);
      }
      es?.close();
    };
  }, [url]);

  return status;
}
