/**
 * Standalone Bull Board server for queue visualization.
 *
 * Run with: pnpm start (from packages/bullboard)
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
import { createGroupQueueRoutes } from "./groupQueues";
import { discoverQueueNames, isGroupQueue, stripHashTag } from "./redisQueues";

const PORT = parseInt(process.env.BULLBOARD_PORT ?? "6380", 10);
if (Number.isNaN(PORT) || PORT < 1 || PORT > 65535) {
  console.error("Invalid BULLBOARD_PORT: must be a number between 1 and 65535");
  process.exit(1);
}

async function main() {
  const redisUrl = process.env.REDIS_URL;
  if (!redisUrl) {
    console.error("REDIS_URL environment variable is required");
    process.exit(1);
  }

  const connection = new IORedis(redisUrl, {
    maxRetriesPerRequest: null,
  });

  const queueNames = await discoverQueueNames(connection);
  const groupQueueNames = queueNames.filter(isGroupQueue);

  console.log("Discovered queues:", queueNames);
  console.log("Group queues:", groupQueueNames.map(stripHashTag));

  const queues = queueNames.map((name) => {
    return new BullMQAdapter(
      new Queue(name, { connection }),
      { displayName: stripHashTag(name) },
    );
  });

  const serverAdapter = new HonoAdapter(serveStatic);
  serverAdapter.setBasePath("/");
  serverAdapter.setUIConfig({
    miscLinks: [{ text: "Groups", url: "/groups" }],
  });

  createBullBoard({
    queues,
    serverAdapter,
  });

  const app = new Hono({ strict: false });

  // Mount group queue routes before BullBoard so /groups and /api/group-queues are matched first
  app.route("/", createGroupQueueRoutes(connection, groupQueueNames));
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
