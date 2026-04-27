import { useEffect, useRef, useState, useCallback } from "react";
import type { DashboardData } from "~/server/app-layer/ops/types";

const SSE_RECYCLE_INTERVAL_MS = 5 * 60 * 1000;

export type ConnectionStatus = "connecting" | "connected" | "disconnected";

export function useOpsSSE() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [status, setStatus] = useState<ConnectionStatus>("connecting");
  const retryDelay = useRef(1000);

  const handleEvent = useCallback(
    (event: string, payload: unknown) => {
      if (event === "dashboard") {
        setData(payload as DashboardData);
      }
    },
    [],
  );

  const handleEventRef = useRef(handleEvent);
  handleEventRef.current = handleEvent;

  useEffect(() => {
    let es: EventSource | null = null;
    let dead = false;
    let recycleTimer: ReturnType<typeof setTimeout> | null = null;

    function connect() {
      if (dead) return;
      setStatus("connecting");
      es = new EventSource("/api/ops/sse");

      es.onopen = () => {
        setStatus("connected");
        retryDelay.current = 1000;

        recycleTimer = setTimeout(() => {
          if (!dead && es) {
            es.close();
            connect();
          }
        }, SSE_RECYCLE_INTERVAL_MS);
      };

      es.addEventListener("dashboard", (e) => {
        try {
          handleEventRef.current("dashboard", JSON.parse(e.data));
        } catch {
          // ignore parse errors
        }
      });

      es.addEventListener("heartbeat", () => {
        // heartbeat received, connection healthy
      });

      es.onerror = () => {
        setStatus("disconnected");
        es?.close();
        if (recycleTimer) {
          clearTimeout(recycleTimer);
          recycleTimer = null;
        }
        const delay = Math.min(retryDelay.current, 30000);
        retryDelay.current = delay * 2;
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
  }, []);

  return { data, status };
}
