import type { Client as ElasticClient } from "@elastic/elasticsearch";
import {
  COLD_STORAGE_AGE_DAYS,
  esClient,
  TRACE_COLD_INDEX,
  TRACE_INDEX,
} from "../../server/elasticsearch";
import { cleanupOrphanedTraces } from "./cleanupOrphanedHotTraces";

const buildColdStorageMigrationQuery = (ageDays: number) => {
  const cutoffDate = new Date().getTime() - ageDays * 24 * 60 * 60 * 1000;

  return {
    bool: {
      must: [
        {
          range: {
            "timestamps.inserted_at": {
              lt: cutoffDate,
            },
          },
        },
      ],
    },
  };
};

type ThrottleLevel = {
  requestsPerSecond: number;
  size: number;
  recoveryBatchSize: number; // How many items to process before trying to speed up
};

const THROTTLE_LEVELS: ThrottleLevel[] = [
  { requestsPerSecond: 200, size: 200, recoveryBatchSize: 0 }, // Fastest
  { requestsPerSecond: 100, size: 100, recoveryBatchSize: 200 }, // Fast
  { requestsPerSecond: 10, size: 10, recoveryBatchSize: 100 }, // Medium
  { requestsPerSecond: 1, size: 1, recoveryBatchSize: 10 }, // Slowest
];

const pollReindexTask = async (
  client: ElasticClient,
  taskId: string,
  expectedTotal: number,
): Promise<{ migrated: number; failed: boolean; processedCount: number }> => {
  const pollInterval = 5000; // 5 seconds

  while (true) {
    try {
      const taskResponse = await client.tasks.get({
        task_id: taskId,
      });

      const task = taskResponse.task;
      const completed = taskResponse.completed;

      if (completed) {
        const response = taskResponse.response;
        if (response?.failures && response?.failures.length > 0) {
          console.error(
            "❌ Reindex task completed with failures:",
            JSON.stringify(response?.failures, null, 2),
          );
          const migrated = (response.created ?? 0) + (response.updated ?? 0);
          return { migrated, failed: true, processedCount: migrated };
        }
        if (taskResponse.error) {
          console.error(
            "❌ Reindex task completed with error:",
            taskResponse.error,
          );
          return { migrated: 0, failed: true, processedCount: 0 };
        }

        const migrated = (response.created ?? 0) + (response.updated ?? 0);
        console.log(`✅ Reindex task completed successfully`);
        return { migrated, failed: false, processedCount: migrated };
      }

      // For sliced tasks, we need to get progress from all child tasks
      // since the parent task shows 0 progress
      let totalCreated = 0;
      let totalUpdated = 0;
      let totalProcessed = 0;
      let hasChildTasks = false;
      let hasFailures = false;

      // Check if this is a sliced task by looking for child tasks
      try {
        const allTasksResponse = await client.tasks.list({
          actions: "*reindex",
          detailed: true,
          parent_task_id: taskId,
        });

        if (
          allTasksResponse.nodes &&
          Object.keys(allTasksResponse.nodes).length > 0
        ) {
          hasChildTasks = true;

          // Aggregate progress from all child tasks
          for (const [_nodeId, nodeData] of Object.entries(
            allTasksResponse.nodes,
          )) {
            const nodeTasks = nodeData!.tasks;
            for (const [_childTaskId, childTask] of Object.entries(nodeTasks)) {
              if (childTask!.status) {
                totalCreated += childTask!.status.created || 0;
                totalUpdated += childTask!.status.updated || 0;
                totalProcessed +=
                  (childTask!.status.created || 0) +
                  (childTask!.status.updated || 0);
                // Check for failures in child tasks
                if (
                  childTask!.status.failures &&
                  childTask!.status.failures.length > 0
                ) {
                  hasFailures = true;
                }
              }
            }
          }
        }
      } catch (childTaskError) {
        console.warn(
          "⚠️ Could not fetch child task progress:",
          (childTaskError as any).message,
        );
      }

      // Show progress
      if (hasChildTasks && totalProcessed > 0) {
        const progress =
          expectedTotal > 0
            ? Math.round((totalProcessed / expectedTotal) * 100)
            : 0;
        console.log(
          `⏳ Reindex progress: ${totalProcessed}/${expectedTotal} (${progress}%) [Created: ${totalCreated}, Updated: ${totalUpdated}]`,
        );
        if (progress === 100) {
          console.log(`✅ Reindex task completed successfully`);
          return {
            migrated: totalProcessed,
            failed: false,
            processedCount: totalProcessed,
          };
        }
      } else if (task.status) {
        // Fallback to parent task status if no child tasks found
        const { created = 0, updated = 0, total = expectedTotal } = task.status;
        const processed = created + updated;
        const progress = total > 0 ? Math.round((processed / total) * 100) : 0;
        console.log(
          `⏳ Reindex progress: ${processed}/${total} (${progress}%) [Created: ${created}, Updated: ${updated}]`,
        );
        totalProcessed = processed;
        // Check for failures in parent task
        if (task.status.failures && task.status.failures.length > 0) {
          hasFailures = true;
        }
      }

      // Check if task failed or has failures during execution
      if (
        !!task.cancelled ||
        (task.status?.failures && task.status.failures.length > 0) ||
        hasFailures
      ) {
        const failures = task.status?.failures || [];
        console.error("❌ Reindex task has failures:", failures);
        // Cancel the task
        try {
          await client.tasks.cancel({ task_id: taskId });
          console.log("🛑 Cancelled failing reindex task");
        } catch (cancelError) {
          console.warn("⚠️ Could not cancel task:", cancelError);
        }
        return {
          migrated: totalProcessed,
          failed: true,
          processedCount: totalProcessed,
        };
      }

      // Wait before next poll
      await new Promise((resolve) => setTimeout(resolve, pollInterval));
    } catch (error: any) {
      if (error.message?.includes("Reindex task failed")) {
        throw error; // Re-throw our custom errors
      }
      console.error("❌ Error polling reindex task:", error);
      throw new Error(`Failed to poll reindex task: ${error.message}`);
    }
  }
};

const adaptiveReindex = async (
  client: ElasticClient,
  query: any,
  ageDays: number,
  organizationId?: string,
): Promise<number> => {
  let totalMigrated = 0;
  let currentThrottleIndex = 0; // Start with fastest
  let itemsSinceLastSpeedUp = 0;

  while (true) {
    // Check how many items remain to migrate
    const countResponse = await client.count({
      index: TRACE_INDEX.alias,
      body: { query },
    });

    const remaining = countResponse.count;
    if (remaining < 100) {
      console.log("✅ <100 traces remaining, stopping migration");
      break;
    }

    const throttle = THROTTLE_LEVELS[currentThrottleIndex]!;

    // Determine how many items to process in this batch
    let batchLimit: number | undefined = undefined;
    if (currentThrottleIndex > 0 && itemsSinceLastSpeedUp === 0) {
      // Just dropped down, process recovery batch
      batchLimit = Math.min(throttle.recoveryBatchSize, remaining);
      console.log(
        `🔄 Processing recovery batch of ${batchLimit} items at ${throttle.requestsPerSecond} req/s, size ${throttle.size}`,
      );
    } else {
      // Normal processing or trying to speed up
      console.log(
        `⚡ Processing ${remaining} remaining items at ${throttle.requestsPerSecond} req/s, size ${throttle.size}`,
      );
    }

    // Start reindex with current throttle settings
    const reindexResponse = await client.reindex({
      wait_for_completion: false,
      slices: "auto",
      requests_per_second: throttle.requestsPerSecond,
      body: {
        conflicts: "proceed",
        source: {
          index: TRACE_INDEX.alias,
          query: query,
          size: throttle.size,
        },
        dest: {
          index: TRACE_COLD_INDEX.base,
        },
        ...(batchLimit ? { max_docs: batchLimit } : {}),
      },
    });

    const taskId = reindexResponse.task;
    if (!taskId) {
      throw new Error(
        `Reindex task failed to be created: ${JSON.stringify(reindexResponse)}`,
      );
    }

    console.log(`📋 Reindex task started with ID: ${taskId}`);

    // Poll task and check for failures
    const result = await pollReindexTask(
      client,
      `${taskId}`,
      batchLimit ?? remaining,
    );

    if (result.failed) {
      console.error(
        `❌ Reindex failed at throttle level ${currentThrottleIndex} (${throttle.requestsPerSecond} req/s)`,
      );
      console.log(
        `🧹 Cleaning up successfully migrated traces from hot storage...`,
      );

      // Cleanup traces that were successfully migrated before the failure
      await cleanupOrphanedTraces(ageDays, organizationId, 1000, false);

      // Wait 5 seconds before dropping down to next throttle level
      await new Promise((resolve) => setTimeout(resolve, 5000));

      // Drop down to next throttle level
      if (currentThrottleIndex < THROTTLE_LEVELS.length - 1) {
        currentThrottleIndex++;
        itemsSinceLastSpeedUp = 0;
        console.log(
          `⬇️  Dropping to throttle level ${currentThrottleIndex}: ${THROTTLE_LEVELS[currentThrottleIndex]!.requestsPerSecond} req/s`,
        );
      } else {
        throw new Error(
          `Failed even at slowest throttle level (${throttle.requestsPerSecond} req/s)`,
        );
      }
    } else {
      totalMigrated += result.migrated;
      itemsSinceLastSpeedUp += result.migrated;
      console.log(
        `✅ Successfully processed ${result.migrated} items (total migrated so far: ${totalMigrated})`,
      );

      // Cleanup migrated traces from hot storage after successful reindex
      console.log(
        `🧹 Cleaning up successfully migrated traces from hot storage...`,
      );
      await cleanupOrphanedTraces(ageDays, organizationId, 1000, false);

      // Try to speed up if we've processed the recovery batch successfully
      if (
        currentThrottleIndex > 0 &&
        itemsSinceLastSpeedUp >= throttle.recoveryBatchSize
      ) {
        console.log(
          `🚀 Attempting to speed up after processing ${itemsSinceLastSpeedUp} items successfully`,
        );
        currentThrottleIndex--;
        itemsSinceLastSpeedUp = 0;
        console.log(
          `⬆️  Speeding up to throttle level ${currentThrottleIndex}: ${THROTTLE_LEVELS[currentThrottleIndex]!.requestsPerSecond} req/s`,
        );
      } else {
        console.log("✅ Traces migrated successfully");
        break;
      }
    }

    // Small delay between batches
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }

  return totalMigrated;
};

const migrateTracesToColdStorage = async (
  ageDays: number,
  organizationId?: string,
) => {
  const client = await esClient(
    organizationId ? { organizationId } : undefined,
  );

  console.log(`🔍 Searching for traces older than ${ageDays} days...`);

  const query = buildColdStorageMigrationQuery(ageDays);

  // First, count how many documents we'll be migrating
  const countResponse = await client.count({
    index: TRACE_INDEX.alias,
    body: { query },
  });

  const totalToMigrate = countResponse.count;
  console.log(`📊 Found ${totalToMigrate} traces to migrate to cold storage`);

  if (totalToMigrate === 0) {
    console.log("✅ No traces to migrate");
    return { migrated: 0, errors: 0 };
  }

  // Cleanup traces that were successfully migrated before
  await cleanupOrphanedTraces(ageDays, organizationId, 1000, false);

  // Step 1: Reindex old traces to cold storage with adaptive throttling
  console.log(
    `📤 Starting adaptive reindex of ${totalToMigrate} traces to cold storage...`,
  );

  const reindexed = await adaptiveReindex(
    client,
    query,
    ageDays,
    organizationId,
  );

  console.log(`✅ Successfully reindexed ${reindexed} traces to cold storage`);

  if (reindexed !== totalToMigrate) {
    console.warn(
      `⚠️  Expected to reindex ${totalToMigrate} traces, but reindexed ${reindexed}`,
    );
  }

  // Cleanup is already done incrementally after each batch in adaptiveReindex
  return { migrated: reindexed, errors: 0 };
};

const verifyMigration = async (ageDays: number, organizationId?: string) => {
  console.log("🔍 Verifying migration...");

  const client = await esClient(
    organizationId ? { organizationId } : undefined,
  );
  const query = buildColdStorageMigrationQuery(ageDays);

  // Check remaining old traces in hot storage
  const hotCount = await client.count({
    index: TRACE_INDEX.alias,
    body: { query },
  });

  // Check traces in cold storage
  const coldCount = await client.count({
    index: TRACE_COLD_INDEX.alias,
    body: {
      query: {
        match_all: {},
      },
    },
  });

  console.log(`📊 Verification results:`);
  console.log(`  - Remaining old traces in hot storage: ${hotCount.count}`);
  console.log(`  - Total traces in cold storage: ${coldCount.count}`);

  if (hotCount.count > 0) {
    console.warn(`⚠️  ${hotCount.count} old traces still remain in hot storage`);
  } else {
    console.log(`✅ All old traces successfully migrated to cold storage`);
  }
};

export const migrateToColdStorage = async (
  ageDays: number = COLD_STORAGE_AGE_DAYS,
  organizationId?: string,
) => {
  console.log("🚀 Starting migration to cold storage...");
  console.log(`📅 Migrating traces older than ${ageDays} days`);

  const client = await esClient(
    organizationId ? { organizationId } : undefined,
  );

  // Check if cold storage index exists
  const coldIndexExists = await client.indices.exists({
    index: TRACE_COLD_INDEX.base,
  });

  if (!coldIndexExists) {
    console.log(
      "⚠️  Cold storage index does not exist, skipping moving traces to cold storage",
    );
    console.log(
      `💡 Run 'setupColdStorage' task first to create the ${TRACE_COLD_INDEX.base} index`,
    );
    return;
  }

  try {
    const result = await migrateTracesToColdStorage(ageDays, organizationId);

    console.log("");
    console.log("📋 Migration Summary:");
    console.log(`  - Traces migrated: ${result.migrated}`);
    console.log(`  - Errors encountered: ${result.errors}`);

    if (result.errors > 0) {
      console.warn(`⚠️  Migration completed with ${result.errors} errors`);
    } else {
      console.log("✅ Migration completed successfully!");
    }

    await verifyMigration(ageDays, organizationId);

    return result;
  } catch (error) {
    console.error("❌ Cold storage migration failed:", error);
    throw error;
  }
};

export default async function execute(
  ageDays: number,
  organizationId?: string,
) {
  await migrateToColdStorage(ageDays, organizationId);
}
