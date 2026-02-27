import { Router } from "express";
import type { SSEManager } from "../sse/sseManager.ts";
import type { MetricsCollector } from "../services/metricsCollector.ts";
import { SSE_PUSH_INTERVAL_MS } from "../../shared/constants.ts";

export function createSSERouter(sseManager: SSEManager, metrics: MetricsCollector): Router {
  const router = Router();

  router.get("/api/sse", async (req, res) => {
    const clientId = sseManager.addClient(res);
    console.log(`SSE client connected: ${clientId}`);

    // Send initial data immediately
    try {
      const dashboard = await metrics.getDashboardData();
      res.write(`event: dashboard\ndata: ${JSON.stringify(dashboard)}\n\n`);
    } catch (err) {
      console.error("SSE initial data error:", err);
    }

    // Push updates on interval — compute payload once per cycle, write to this client
    const pushInterval = setInterval(async () => {
      try {
        const dashboard = await metrics.getDashboardData();
        res.write(`event: dashboard\ndata: ${JSON.stringify(dashboard)}\n\n`);
      } catch (err) {
        console.error("SSE push error:", err);
      }
    }, SSE_PUSH_INTERVAL_MS);

    res.on("close", () => {
      clearInterval(pushInterval);
      console.log(`SSE client disconnected: ${clientId}`);
    });
  });

  return router;
}
