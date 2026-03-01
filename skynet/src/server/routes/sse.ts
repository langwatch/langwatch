import { Router } from "express";
import type { SSEManager } from "../sse/sseManager.ts";
import type { MetricsCollector } from "../services/metricsCollector.ts";

export function createSSERouter(sseManager: SSEManager, metrics: MetricsCollector): Router {
  const router = Router();

  router.get("/api/sse", (req, res) => {
    const clientId = sseManager.addClient(res);

    // Send initial data immediately
    try {
      const dashboard = metrics.getDashboardData();
      res.write(`event: dashboard\ndata: ${JSON.stringify(dashboard)}\n\n`);
    } catch (err) {
      console.error("SSE initial data error:", err);
    }

    // Ongoing dashboard pushes are handled by SSEManager.startDashboardBroadcast()
  });

  return router;
}
