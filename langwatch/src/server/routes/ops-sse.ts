/**
 * Hono route for the Ops dashboard SSE feed.
 *
 * Replaces src/pages/api/ops/sse.ts (Pages Router handler that the Hono
 * api-router never picked up — hence the 404 on /api/ops/sse).
 */
import { Hono } from "hono";
import { getApp } from "~/server/app-layer/app";
import { resolveOpsScope } from "~/server/api/rbac";
import { getServerAuthSession } from "~/server/auth";
import { prisma } from "~/server/db";
import type { SSEStream } from "~/server/app-layer/ops/metrics-collector";
import { createLogger } from "~/utils/logger/server";

const logger = createLogger("langwatch:ops:sse");

export const app = new Hono().basePath("/api");

app.get("/ops/sse", async (c) => {
  const raw = c.req.raw;

  const session = await getServerAuthSession({
    req: raw as unknown as Parameters<typeof getServerAuthSession>[0]["req"],
  });
  if (!session?.user) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  const opsScope = await resolveOpsScope({
    userId: session.user.id,
    userEmail: session.user.email,
    permission: "ops:view",
    prisma,
  });
  if (!opsScope) {
    return c.json({ error: "Forbidden" }, 403);
  }

  const collector = getApp().ops?.metricsCollector;
  if (!collector) {
    return c.json({ error: "Ops metrics not available" }, 503);
  }

  const encoder = new TextEncoder();

  const body = new ReadableStream({
    start(controller) {
      let ended = false;

      const stream: SSEStream = {
        write(chunk: string) {
          if (ended) return;
          try {
            controller.enqueue(encoder.encode(chunk));
          } catch {
            end();
          }
        },
        end() {
          end();
        },
      };

      const end = () => {
        if (ended) return;
        ended = true;
        try {
          collector.removeClient(stream);
        } catch {
          // ignore
        }
        try {
          controller.close();
        } catch {
          // already closed
        }
      };

      // SSE comment line to confirm the connection is alive.
      stream.write(":ok\n\n");

      collector.addClient(stream);

      try {
        const data = collector.getDashboardData();
        stream.write(`event: dashboard\ndata: ${JSON.stringify(data)}\n\n`);
      } catch (err) {
        logger.warn(
          { error: err },
          "Initial dashboard data not yet available",
        );
      }

      raw.signal?.addEventListener("abort", end);
    },
  });

  return new Response(body, {
    status: 200,
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
});
