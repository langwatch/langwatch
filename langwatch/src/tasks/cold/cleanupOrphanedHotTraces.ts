import {
  TRACE_INDEX,
  TRACE_COLD_INDEX,
  esClient,
  COLD_STORAGE_AGE_DAYS,
} from "../../server/elasticsearch";
import { type Client as ElasticClient } from "@elastic/elasticsearch";

const buildOldTracesQuery = (ageDays: number) => {
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

const checkTracesExistInColdBatch = async (
  client: ElasticClient,
  traceIds: string[],
): Promise<Set<string>> => {
  if (traceIds.length === 0) {
    return new Set();
  }

  try {
    const response = await client.search({
      index: TRACE_COLD_INDEX.alias,
      body: {
        query: {
          ids: {
            values: traceIds,
          },
        },
        size: traceIds.length,
        _source: false, // We only need the IDs
      },
    });

    const existingIds = new Set<string>();
    for (const hit of response.hits.hits) {
      if (hit._id) {
        existingIds.add(hit._id);
      }
    }

    return existingIds;
  } catch (error) {
    console.error(
      `❌ Error checking batch of ${traceIds.length} traces in cold storage:`,
      error,
    );
    return new Set();
  }
};

const cleanupOrphanedHotTraces = async (
  ageDays: number,
  organizationId?: string,
  batchSize = 1000,
  dryRun = false,
) => {
  const client = await esClient(
    organizationId ? { organizationId } : undefined,
  );

  console.log(
    `🔍 Searching for traces older than ${ageDays} days in hot storage...`,
  );

  const query = buildOldTracesQuery(ageDays);

  // First, count how many old documents exist in hot storage
  const countResponse = await client.count({
    index: TRACE_INDEX.alias,
    body: { query },
  });

  const totalOldTraces = countResponse.count;
  console.log(`📊 Found ${totalOldTraces} old traces in hot storage to check`);

  if (totalOldTraces === 0) {
    console.log("✅ No old traces found in hot storage");
    return { checked: 0, foundInCold: 0, deleted: 0, errors: 0 };
  }

  let checked = 0;
  let foundInCold = 0;
  let deleted = 0;
  let errors = 0;

  // Use scroll API to iterate through all old traces
  console.log(
    `🔄 Starting to check traces (batch size: ${batchSize})...${
      dryRun ? " [DRY RUN]" : ""
    }`,
  );

  let scrollId: string | undefined;
  try {
    // Initial search with scroll
    const initialResponse = await client.search({
      index: TRACE_INDEX.alias,
      scroll: "5m",
      size: batchSize,
      body: {
        query,
        _source: false, // We only need the IDs
      },
    });

    scrollId = initialResponse._scroll_id;
    let hits = initialResponse.hits.hits;

    while (hits.length > 0) {
      // Collect all trace IDs from this batch
      const batchTraceIds: string[] = [];
      for (const hit of hits) {
        if (hit._id) {
          batchTraceIds.push(hit._id);
        }
      }

      checked += batchTraceIds.length;

      if (checked % 1000 === 0 || checked === batchTraceIds.length) {
        const progress = Math.round((checked / totalOldTraces) * 100);
        console.log(
          `⏳ Progress: ${checked}/${totalOldTraces} (${progress}%) - Found in cold: ${foundInCold}`,
        );
      }

      // Check entire batch at once
      const existingInCold = await checkTracesExistInColdBatch(
        client,
        batchTraceIds,
      );

      foundInCold += existingInCold.size;

      // Only delete traces that exist in cold storage
      const tracesToDelete = batchTraceIds.filter((id) =>
        existingInCold.has(id),
      );

      if (tracesToDelete.length > 0) {
        if (!dryRun) {
          try {
            const bulkBody = tracesToDelete.flatMap((id) => [
              { delete: { _index: TRACE_INDEX.alias, _id: id } },
            ]);

            const bulkResponse = await client.bulk({
              body: bulkBody,
              refresh: false,
            });

            if (bulkResponse.errors) {
              const failedItems = bulkResponse.items.filter(
                (item) => item.delete?.error,
              );
              errors += failedItems.length;
              deleted += bulkResponse.items.length - failedItems.length;
              console.error(
                `❌ ${failedItems.length} deletions failed in batch`,
              );
            } else {
              deleted += tracesToDelete.length;
            }
          } catch (error) {
            console.error(`❌ Error deleting batch:`, error);
            errors += tracesToDelete.length;
          }
        } else {
          console.log(
            `🔍 [DRY RUN] Would delete ${tracesToDelete.length} traces`,
          );
          deleted += tracesToDelete.length;
        }
      }

      // Get next batch
      if (!scrollId) break;

      const scrollResponse = await client.scroll({
        scroll_id: scrollId,
        scroll: "5m",
      });

      scrollId = scrollResponse._scroll_id;
      hits = scrollResponse.hits.hits;
    }

    // Refresh the index after all deletions (if not dry run)
    if (!dryRun && deleted > 0) {
      await client.indices.refresh({
        index: TRACE_INDEX.alias,
      });
    }
  } finally {
    // Clean up scroll context
    if (scrollId) {
      try {
        await client.clearScroll({ scroll_id: scrollId });
      } catch (error) {
        console.warn("⚠️  Could not clear scroll context:", error);
      }
    }
  }

  return { checked, foundInCold, deleted, errors };
};

const verifyCleanup = async (ageDays: number, organizationId?: string) => {
  console.log("🔍 Verifying cleanup...");

  const client = await esClient(
    organizationId ? { organizationId } : undefined,
  );
  const query = buildOldTracesQuery(ageDays);

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
    console.warn(
      `⚠️  ${hotCount.count} old traces still remain in hot storage`,
    );
    console.log(`💡 These may be traces that don't exist in cold storage yet`);
  } else {
    console.log(`✅ No old traces remaining in hot storage`);
  }
};

export const cleanupOrphanedTraces = async (
  ageDays: number = COLD_STORAGE_AGE_DAYS,
  organizationId?: string,
  batchSize = 100,
  dryRun = false,
) => {
  console.log("🚀 Starting orphaned hot traces cleanup...");
  console.log(`📅 Checking traces older than ${ageDays} days`);
  console.log(
    `🔧 Mode: ${dryRun ? "DRY RUN (no deletions)" : "LIVE (will delete)"}`,
  );

  const client = await esClient(
    organizationId ? { organizationId } : undefined,
  );

  // Check if cold storage index exists
  const coldIndexExists = await client.indices.exists({
    index: TRACE_COLD_INDEX.base,
  });

  if (!coldIndexExists) {
    console.log("⚠️  Cold storage index does not exist, nothing to cleanup");
    return;
  }

  try {
    const result = await cleanupOrphanedHotTraces(
      ageDays,
      organizationId,
      batchSize,
      dryRun,
    );

    console.log("");
    console.log("📋 Cleanup Summary:");
    console.log(`  - Traces checked: ${result.checked}`);
    console.log(`  - Found in cold storage: ${result.foundInCold}`);
    console.log(
      `  - Deleted from hot storage: ${result.deleted}${
        dryRun ? " (would be deleted)" : ""
      }`,
    );
    console.log(`  - Errors encountered: ${result.errors}`);

    if (result.errors > 0) {
      console.warn(`⚠️  Cleanup completed with ${result.errors} errors`);
    } else if (result.deleted > 0) {
      console.log(
        `✅ Cleanup completed successfully! ${result.deleted} traces ${
          dryRun ? "would be" : "were"
        } removed from hot storage`,
      );
    } else {
      console.log("✅ No orphaned traces found to cleanup");
    }

    if (!dryRun) {
      await verifyCleanup(ageDays, organizationId);
    }

    return result;
  } catch (error) {
    console.error("❌ Orphaned traces cleanup failed:", error);
    throw error;
  }
};

export default async function execute(
  ageDays?: number,
  organizationId?: string,
  batchSize?: number,
  dryRun?: boolean,
) {
  await cleanupOrphanedTraces(
    ageDays ?? COLD_STORAGE_AGE_DAYS,
    organizationId,
    batchSize ?? 1000,
    dryRun ?? false,
  );
}
