import "dotenv/config";

import { DEFAULT_PORT, QUEUE_DISCOVERY_INTERVAL_MS } from "../shared/constants.ts";
import { getRedis } from "./services/redis.ts";
import { discoverQueueNames, isGroupQueue } from "./services/queueDiscovery.ts";
import { MetricsCollector } from "./services/metricsCollector.ts";
import { evictStaleQueueCache } from "./services/bullmqService.ts";
import { SSEManager } from "./sse/sseManager.ts";
import { createApp } from "./app.ts";

const PORT = parseInt(process.env.BULLBOARD_PORT ?? String(DEFAULT_PORT), 10);

async function main() {
  const redis = getRedis();

  const allQueueNames = await discoverQueueNames(redis);
  const groupQueueNames = allQueueNames.filter(isGroupQueue);
  let currentQueueNames = [...allQueueNames];
  let currentGroupQueueNames = [...groupQueueNames];

  console.log(`Discovered ${allQueueNames.length} queues (${groupQueueNames.length} group queues)`);

  // Auth warning at startup
  if (process.env.SKYNET_SKIP_AUTH !== "1" && (!process.env.SKYNET_USERNAME || !process.env.SKYNET_PASSWORD)) {
    console.warn(
      "WARNING: SKYNET_USERNAME and/or SKYNET_PASSWORD are not set. " +
      "All routes will be unauthenticated. Set these environment variables to enable Basic Auth."
    );
  }

  const metrics = new MetricsCollector(redis, currentGroupQueueNames);
  metrics.start();

  const sseManager = new SSEManager();
  sseManager.start();

  // Periodic queue discovery
  setInterval(async () => {
    try {
      const names = await discoverQueueNames(redis);
      const newNames = names.filter((n) => !currentQueueNames.includes(n));
      if (newNames.length > 0) {
        console.log(`Discovered ${newNames.length} new queue(s)`);
        currentQueueNames = [...new Set([...currentQueueNames, ...names])];
        currentGroupQueueNames = currentQueueNames.filter(isGroupQueue);
        metrics.updateGroupQueueNames(currentGroupQueueNames);
        evictStaleQueueCache(currentQueueNames);
      }
    } catch (err) {
      console.error("Queue discovery error:", err);
    }
  }, QUEUE_DISCOVERY_INTERVAL_MS);

  const app = createApp({
    redis,
    sseManager,
    metrics,
    getGroupQueueNames: () => currentGroupQueueNames,
    getQueueNames: () => currentQueueNames,
  });

  app.listen(PORT, () => {
    console.log(`Skynet running on http://localhost:${PORT}`);
  });
}

main().catch((err) => {
  console.error("Failed to start Skynet:", err);
  process.exit(1);
});
