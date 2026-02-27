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
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { Queue } from "bullmq";
import { Hono } from "hono";
import { basicAuth } from "hono/basic-auth";
import IORedis from "ioredis";
import { createGroupQueueRoutes } from "./groupQueues.ts";
import { discoverQueueNames, isGroupQueue, stripHashTag } from "./redisQueues.ts";

const PORT = parseInt(process.env.BULLBOARD_PORT ?? "6380", 10);
if (Number.isNaN(PORT) || PORT < 1 || PORT > 65535) {
  console.error("Invalid BULLBOARD_PORT: must be a number between 1 and 65535");
  process.exit(1);
}

/** How often to re-scan Redis for newly created queues (ms). */
const QUEUE_DISCOVERY_INTERVAL_MS = 10_000;

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

  const { addQueue } = createBullBoard({
    queues,
    serverAdapter,
  });

  // Track known queue names so we only add truly new ones
  const knownQueueNames = new Set(queueNames);

  // Periodically re-scan Redis for new queues created after startup
  setInterval(async () => {
    try {
      const currentNames = await discoverQueueNames(connection);
      for (const name of currentNames) {
        if (!knownQueueNames.has(name)) {
          knownQueueNames.add(name);
          addQueue(
            new BullMQAdapter(
              new Queue(name, { connection }),
              { displayName: stripHashTag(name) },
            ),
          );
          if (isGroupQueue(name)) {
            groupQueueNames.push(name);
          }
          console.log("Discovered new queue:", stripHashTag(name));
        }
      }
    } catch (error) {
      console.error("Queue re-discovery failed:", error);
    }
  }, QUEUE_DISCOVERY_INTERVAL_MS);

  const app = new Hono({ strict: false });

  // Health check endpoint (no auth required)
  app.get("/health", (c) => c.text("OK"));

  // Basic auth middleware (skip /health)
  const username = process.env.BULLBOARD_USERNAME;
  const password = process.env.BULLBOARD_PASSWORD;
  if (username && password) {
    app.use("*", basicAuth({ username, password }));
  }

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
