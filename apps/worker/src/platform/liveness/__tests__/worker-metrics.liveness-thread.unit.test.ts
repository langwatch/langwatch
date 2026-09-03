/**
 * @vitest-environment node
 *
 * Boots the real liveness thread (LIVENESS_THREAD_SOURCE, eval'd exactly as
 * production does) against a shared heartbeat: `/healthz` answers from the
 * thread using the heartbeat's age — a saturated-but-alive main loop stays
 * 200, a loop stalled past the budget goes 503 — and non-liveness paths
 * proxy to the parent.
 */
import http from "node:http";
import { Worker } from "node:worker_threads";
import { afterEach, describe, expect, it } from "vitest";
import { LIVENESS_THREAD_SOURCE } from "../worker-metrics.server";
import {
  WORKER_HEARTBEAT_STALL_BUDGET_MS as STALL_BUDGET_MS,
  WORKER_LIVENESS_PATH,
} from "../worker.liveness";

/**
 * The probe path as the Helm chart writes it — `charts/langwatch/templates/
 * workers/deployment.yaml` and `charts/langwatch/tests/e2e.sh` both hard-code
 * this literal. Asserted against the constant, and then USED as the literal
 * below, so renaming the constant fails here instead of in a rolling deploy.
 */
const CHART_PROBE_PATH = "/healthz";

async function getFreePort(): Promise<number> {
  return new Promise((resolve) => {
    const srv = http.createServer();
    srv.listen(0, () => {
      const { port } = srv.address() as { port: number };
      srv.close(() => resolve(port));
    });
  });
}

function fetchStatus(port: number, path: string): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    http
      .get({ port, path, timeout: 2_000 }, (res) => {
        let body = "";
        res.on("data", (c: Buffer) => {
          body += c.toString();
        });
        res.on("end", () => resolve({ status: res.statusCode ?? 0, body }));
      })
      .on("error", reject);
  });
}

describe("worker liveness thread", () => {
  let thread: Worker | undefined;

  afterEach(async () => {
    await thread?.terminate();
    thread = undefined;
  });

  async function bootThread(heartbeat: BigInt64Array): Promise<number> {
    const port = await getFreePort();
    thread = new Worker(LIVENESS_THREAD_SOURCE, {
      eval: true,
      workerData: {
        port,
        livenessPath: WORKER_LIVENESS_PATH,
        heartbeat: heartbeat.buffer,
        stallBudgetMs: STALL_BUDGET_MS,
        proxyTimeoutMs: 500,
      },
    });
    await new Promise<void>((resolve, reject) => {
      thread!.once("error", reject);
      thread!.on("message", (msg: { isListening?: boolean }) => {
        if (msg.isListening) resolve();
      });
    });
    return port;
  }

  describe("when the chart's probe path is compared with the served one", () => {
    it("serves the path the workers Deployment probes", () => {
      expect(WORKER_LIVENESS_PATH).toBe(CHART_PROBE_PATH);
    });
  });

  describe("when the main loop heartbeat is fresh", () => {
    /** @scenario A busy-but-alive main loop still passes liveness */
    it("answers 200 on the liveness path", async () => {
      const heartbeat = new BigInt64Array(new SharedArrayBuffer(8));
      heartbeat[0] = BigInt(Date.now());
      const port = await bootThread(heartbeat);

      const res = await fetchStatus(port, CHART_PROBE_PATH);
      expect(res.status).toBe(200);
      expect(res.body).toBe("ok");
    });
  });

  describe("when the heartbeat is stalled past the budget", () => {
    /** @scenario A main loop stalled past the budget fails liveness */
    it("answers 503 so a genuinely dead main loop still gets restarted", async () => {
      const heartbeat = new BigInt64Array(new SharedArrayBuffer(8));
      heartbeat[0] = BigInt(Date.now() - STALL_BUDGET_MS - 60_000);
      const port = await bootThread(heartbeat);

      const res = await fetchStatus(port, CHART_PROBE_PATH);
      expect(res.status).toBe(503);
      expect(res.body).toContain("stalled");
    });
  });

  describe("when a non-liveness path is requested", () => {
    /** @scenario Metrics proxy through to the main thread */
    it("proxies to the parent and serves its reply", async () => {
      const heartbeat = new BigInt64Array(new SharedArrayBuffer(8));
      heartbeat[0] = BigInt(Date.now());
      const port = await bootThread(heartbeat);
      thread!.on("message", (msg: { id?: number; url?: string; authorization?: string | null }) => {
        if (msg.id === undefined) return;
        thread!.postMessage({
          id: msg.id,
          status: 200,
          headers: { "Content-Type": "text/plain" },
          body: `proxied:${msg.url}`,
        });
      });

      const res = await fetchStatus(port, "/metrics");
      expect(res.status).toBe(200);
      expect(res.body).toBe("proxied:/metrics");
    });

    /** @scenario A metrics request fails when the main thread never replies */
    it("answers 503 when the parent never replies (stalled main loop)", async () => {
      const heartbeat = new BigInt64Array(new SharedArrayBuffer(8));
      heartbeat[0] = BigInt(Date.now());
      const port = await bootThread(heartbeat);

      const res = await fetchStatus(port, "/metrics");
      expect(res.status).toBe(503);
    });
  });
});
