import { TRACE_INDEX, esClient, traceIndexId } from "../server/elasticsearch";
import { createLogger } from "../utils/logger";

const logger = createLogger("langwatch:tasks:syncTraceCosts");

/**
 * This task syncs the trace costs by recalculating them from the span costs in Elasticsearch.
 * This is used to fix traces where the total_cost was not properly calculated from individual span costs.
 *
 * IMPROVEMENTS:
 * - Processes all traces globally instead of by project (more efficient)
 * - Only updates traces where the calculated cost differs from existing cost
 * - Uses scroll API instead of offset pagination for better performance
 * - Optimized Painless script with fewer null checks
 * - Better error handling and performance monitoring
 */

export default async function execute() {
  logger.info("Starting trace cost sync for all projects");

  let totalProcessedCount = 0;
  let totalUpdatedCount = 0;
  let totalSkippedCount = 0;
  let consecutiveFailures = 0;
  const maxConsecutiveFailures = 10;

  // Use a single Elasticsearch client for all operations
  const client = await esClient({ test: true });

  // Use scroll API for better performance with large datasets
  const scrollTimeout = "5m";
  const batchSize = 500; // Smaller batch size for scroll API
  const bulkBatchSize = 50; // Smaller bulk batches for better error handling

  try {
    // Initial search to start scrolling
    const searchResponse = await client.search({
      index: TRACE_INDEX.alias,
      scroll: scrollTimeout,
      size: batchSize,
      body: {
        query: {
          bool: {
            must: [
              {
                nested: {
                  path: "spans",
                  query: {
                    exists: {
                      field: "spans.metrics.cost",
                    },
                  },
                },
              },
            ],
          },
        },
        _source: [
          "trace_id",
          "project_id",
          "spans.metrics.cost",
          "metrics.total_cost",
        ],
        sort: [{ _doc: { order: "asc" } }], // Use _doc for better scroll performance
      },
    });

    let scrollId = searchResponse._scroll_id;
    let hits = searchResponse.hits.hits;

    logger.info(
      { totalHits: searchResponse.hits.total, batchSize },
      "Starting scroll through traces with span costs"
    );

    // Process all traces using scroll API
    while (hits.length > 0) {
      const bulkActions: any[] = [];
      let bulkProcessedCount = 0;

      // Process each trace in the current batch
      for (const hit of hits) {
        const traceId = (hit._source as any).trace_id;
        const projectId = (hit._source as any).project_id;
        const spans = (hit._source as any).spans || [];
        const existingTotalCost = (hit._source as any).metrics?.total_cost;

        // Skip if no trace ID, project ID, or spans
        if (!traceId || !projectId || !Array.isArray(spans)) {
          logger.warn({ traceId, projectId }, "Invalid trace data, skipping");
          totalSkippedCount++;
          continue;
        }

        try {
          // Calculate total cost from spans
          let calculatedTotalCost = 0;
          let hasValidCosts = false;

          for (const span of spans) {
            if (
              span.metrics?.cost !== null &&
              span.metrics?.cost !== undefined
            ) {
              calculatedTotalCost += span.metrics.cost;
              hasValidCosts = true;
            }
          }

          // Round to 6 decimal places to match existing precision
          calculatedTotalCost = Number(calculatedTotalCost.toFixed(6));

          // Only update if the cost is different or if we have valid costs but no existing cost
          const shouldUpdate =
            hasValidCosts &&
            (existingTotalCost === null ||
              existingTotalCost === undefined ||
              Math.abs(calculatedTotalCost - existingTotalCost) > 0.000001); // Account for floating point precision

          if (shouldUpdate) {
            bulkActions.push({
              update: {
                _index: TRACE_INDEX.alias,
                _id: traceIndexId({
                  traceId,
                  projectId,
                }),
                retry_on_conflict: 10,
              },
            });

            bulkActions.push({
              script: {
                source: `
                  // Optimized script to calculate total cost from spans
                  double totalCost = 0.0;
                  boolean hasValidCosts = false;
                  
                  if (ctx._source.spans instanceof List) {
                    for (span in ctx._source.spans) {
                      if (span?.metrics?.cost != null) {
                        totalCost += span.metrics.cost;
                        hasValidCosts = true;
                      }
                    }
                  }
                  
                  // Update trace metrics only if we have valid costs
                  if (hasValidCosts) {
                    if (!ctx._source.containsKey('metrics')) {
                      ctx._source.metrics = new HashMap();
                    }
                    ctx._source.metrics.total_cost = totalCost;
                  }
                `,
                lang: "painless",
              },
            });

            bulkProcessedCount++;
          }

          totalProcessedCount++;

          // Execute bulk operations when batch size is reached
          if (bulkActions.length >= bulkBatchSize * 2) {
            try {
              const bulkResult = await client.bulk({ body: bulkActions });
              if (bulkResult.errors) {
                logger.error({ bulkResult }, "Bulk operation had errors");
                consecutiveFailures++;
              } else {
                totalUpdatedCount += bulkProcessedCount;
                consecutiveFailures = 0; // Reset consecutive failures on success
              }
            } catch (bulkError) {
              consecutiveFailures++;
              logger.error(
                { bulkError, consecutiveFailures },
                "Failed to execute bulk update"
              );
            }

            // Stop processing if too many consecutive failures
            if (consecutiveFailures >= maxConsecutiveFailures) {
              logger.error(
                { consecutiveFailures },
                "Too many consecutive failures, stopping processing"
              );
              break;
            }

            // Reset bulk operations
            bulkActions.length = 0;
            bulkProcessedCount = 0;
          }

          // Log progress every 1000 traces
          if (totalProcessedCount % 1000 === 0) {
            logger.info(
              {
                totalProcessedCount,
                totalUpdatedCount,
                totalSkippedCount,
                consecutiveFailures,
              },
              "Progress update"
            );
          }
        } catch (error) {
          logger.error(
            { error, traceId, projectId },
            "Failed to process trace"
          );
          totalSkippedCount++;
        }
      }

      // Execute remaining bulk operations
      if (bulkActions.length > 0) {
        try {
          const bulkResult = await client.bulk({ body: bulkActions });
          if (bulkResult.errors) {
            logger.error({ bulkResult }, "Bulk operation had errors");
          } else {
            totalUpdatedCount += bulkProcessedCount;
          }
        } catch (bulkError) {
          logger.error({ bulkError }, "Failed to execute final bulk update");
        }
      }

      // Get next batch using scroll API
      try {
        const scrollResponse = await client.scroll({
          scroll_id: scrollId,
          scroll: scrollTimeout,
        });
        scrollId = scrollResponse._scroll_id;
        hits = scrollResponse.hits.hits;
      } catch (scrollError) {
        logger.error({ scrollError }, "Failed to scroll to next batch");
        break;
      }

      // Break if we've had too many consecutive failures
      if (consecutiveFailures >= maxConsecutiveFailures) {
        break;
      }
    }

    // Clear the scroll context
    try {
      await client.clearScroll({
        scroll_id: scrollId,
      });
    } catch (clearScrollError) {
      logger.warn({ clearScrollError }, "Failed to clear scroll context");
    }
  } catch (error) {
    logger.error({ error }, "Failed to start trace cost sync");
    throw error;
  }

  logger.info(
    {
      totalProcessedCount,
      totalUpdatedCount,
      totalSkippedCount,
      consecutiveFailures,
    },
    "Finished syncing all trace costs"
  );
}
