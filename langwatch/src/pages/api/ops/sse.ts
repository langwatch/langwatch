import type { NextApiRequest, NextApiResponse } from "next";
import { getServerAuthSession } from "~/server/auth";
import { prisma } from "~/server/db";
import { resolveOpsScope } from "~/server/api/rbac";
import { getApp } from "~/server/app-layer/app";
import { createLogger } from "~/utils/logger/server";

const logger = createLogger("langwatch:ops:sse");

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  if (req.method !== "GET") {
    res.status(405).end();
    return;
  }

  const session = await getServerAuthSession({ req, res });
  if (!session?.user) {
    res.status(401).end();
    return;
  }

  const opsScope = await resolveOpsScope({
    userId: session.user.id,
    userEmail: session.user.email,
    permission: "ops:view",
    prisma,
  });
  if (!opsScope) {
    res.status(403).end();
    return;
  }

  const collector = getApp().ops?.metricsCollector;
  if (!collector) {
    res.status(503).json({ error: "Ops metrics not available" });
    return;
  }

  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });

  // SSE comment line to confirm connection is alive
  res.write(`:ok\n\n`);

  collector.addClient(res);

  try {
    const data = collector.getDashboardData();
    res.write(`event: dashboard\ndata: ${JSON.stringify(data)}\n\n`);
  } catch (err) {
    logger.warn({ error: err }, "Initial dashboard data not yet available");
  }

  req.on("close", () => {
    collector.removeClient(res);
  });

  req.on("error", (err) => {
    logger.warn({ error: err }, "SSE client connection error");
    collector.removeClient(res);
  });
}
