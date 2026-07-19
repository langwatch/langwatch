import { useState } from "react";
import type { DashboardData } from "~/server/app-layer/ops/types";
import { api } from "~/utils/api";

export type ConnectionStatus = "connecting" | "connected" | "disconnected";

export function useOpsSSE() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [status, setStatus] = useState<ConnectionStatus>("connecting");

  api.ops.dashboardStream.useSubscription(undefined, {
    onStarted: () => setStatus("connecting"),
    onData: (payload) => {
      setData(payload);
      setStatus("connected");
    },
    onError: () => setStatus("disconnected"),
  });

  return { data, status };
}
