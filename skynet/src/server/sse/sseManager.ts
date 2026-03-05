import type { Response } from "express";
import { SSE_HEARTBEAT_INTERVAL_MS, SSE_PUSH_INTERVAL_MS } from "../../shared/constants.ts";
import type { MetricsCollector } from "../services/metricsCollector.ts";

interface SSEClient {
  id: string;
  res: Response;
}

export class SSEManager {
  private clients: SSEClient[] = [];
  private heartbeatInterval: ReturnType<typeof setInterval> | null = null;
  private dashboardInterval: ReturnType<typeof setInterval> | null = null;
  private clientCounter = 0;
  private metrics: MetricsCollector | null = null;

  start(): void {
    this.heartbeatInterval = setInterval(() => {
      this.broadcast("heartbeat", { timestamp: Date.now() });
    }, SSE_HEARTBEAT_INTERVAL_MS);
  }

  startDashboardBroadcast(metrics: MetricsCollector): void {
    this.metrics = metrics;
    this.dashboardInterval = setInterval(() => {
      try {
        if (this.clients.length === 0) return;
        const data = metrics.getDashboardData();
        this.broadcast("dashboard", data);
      } catch (err) {
        console.error("Dashboard broadcast error:", err);
      }
    }, SSE_PUSH_INTERVAL_MS);
  }

  stop(): void {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
    if (this.dashboardInterval) {
      clearInterval(this.dashboardInterval);
      this.dashboardInterval = null;
    }
    for (const client of this.clients) {
      client.res.end();
    }
    this.clients = [];
  }

  addClient(res: Response): string {
    const id = `client-${++this.clientCounter}`;

    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });

    res.write(`:ok\n\n`);

    const client: SSEClient = { id, res };
    this.clients.push(client);

    res.on("close", () => {
      this.clients = this.clients.filter((c) => c.id !== id);
    });

    return id;
  }

  broadcast(event: string, data: unknown): void {
    const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const client of this.clients) {
      try {
        client.res.write(payload);
      } catch {
        // Client disconnected, will be cleaned up
      }
    }
  }

  get clientCount(): number {
    return this.clients.length;
  }
}
