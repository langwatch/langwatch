/**
 * Standalone Bull Board server for queue visualization.
 *
 * Run with: pnpm run bullboard
 * Access at: http://localhost:6380
 *
 * Only for development use.
 */

import "dotenv/config";
import { createBullBoard } from "@bull-board/api";
import { BullMQAdapter } from "@bull-board/api/bullMQAdapter";
import { HonoAdapter } from "@bull-board/hono";
import { serveStatic } from "@hono/node-server/serve-static";
import { serve } from "@hono/node-server";
import { Queue } from "bullmq";
import { Hono } from "hono";
import IORedis from "ioredis";

const PORT = 6380;

async function main() {
  const redisUrl = process.env.REDIS_URL;
  if (!redisUrl) {
    console.error("REDIS_URL environment variable is required");
    process.exit(1);
  }

  const connection = new IORedis(redisUrl, {
    maxRetriesPerRequest: null,
  });

  // Discover all queues from Redis - handles both standalone and cluster mode
  const allBullKeys = await connection.keys("bull:*");
  const queueNames = Array.from(
    new Set(
      allBullKeys.map((key) =>
        key.split(":")[1]?.replace("{", "").replace("}", "")
      )
    )
  ).filter(Boolean) as string[];

  console.log("Discovered queues:", queueNames);

  const queues = queueNames.map(
    (name) => new BullMQAdapter(new Queue(name, { connection }))
  );

  const serverAdapter = new HonoAdapter(serveStatic);
  serverAdapter.setBasePath("/");

  createBullBoard({
    queues,
    serverAdapter,
  });

  const app = new Hono({ strict: false });
  app.route("/", serverAdapter.registerPlugin());

  console.log(`Bull Board running on http://localhost:${PORT}`);
  console.log("Press Ctrl+C to stop");

  serve({
    fetch: app.fetch,
    port: PORT,
  });
}

main().catch((error) => {
  console.error("Failed to start Bull Board:", error);
  process.exit(1);
});
