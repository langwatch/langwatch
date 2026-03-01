import { Router } from "express";
import type { MetricsCollector } from "../services/metricsCollector.ts";

export function createDashboardRouter(metrics: MetricsCollector): Router {
  const router = Router();

  router.get("/api/dashboard", (_req, res) => {
    try {
      const data = metrics.getDashboardData();
      res.json(data);
    } catch (err) {
      console.error("Dashboard error:", err);
      res.status(500).json({ error: "Failed to fetch dashboard data" });
    }
  });

  return router;
}
