import { TRACE_INDEX, esClient, traceIndexId } from "../server/elasticsearch";
import { prisma } from "../server/db";
import { createLogger } from "../utils/logger";

const logger = createLogger("langwatch:tasks:syncTraceCosts");

/**
 * This task syncs the trace costs by recalculating them from the span costs in Elasticsearch.
 * This is used to fix traces where the total_cost was not properly calculated from individual span costs.
 *
 * The script iterates through all spans in a trace and sums up their individual costs to set the trace's total_cost.
 */

export default async function execute() {
  // Get all projects to process
  const projects = await prisma.project.findMany({
    select: { id: true },
  });

  logger.info({ count: projects.length }, "Found projects to process");

  let totalProcessedCount = 0;
  let totalUpdatedCount = 0;

  // Use a single Elasticsearch client for all operations to avoid team relationship issues
  const client = await esClient({ test: true });

  // Process each project
  for (const project of projects) {
    const projectId = project.id;
    logger.info({ projectId }, "Processing project");
    let processedCount = 0;
    let updatedCount = 0;
    let consecutiveFailures = 0;
    const maxConsecutiveFailures = 10; // Stop processing if too many consecutive failures

    let from = 0;
    const batchSize = 1000;
    const bulkBatchSize = 100; // Process bulk updates in smaller batches

    // Process all traces in the project using offset pagination
    while (true) {
      // Search for traces that have spans with costs but may have incorrect total_cost
      let searchResponse;
      try {
        const searchBody: any = {
          query: {
            bool: {
              must: [
                { term: { project_id: projectId } },
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
          size: batchSize,
          from: from,
          sort: [{ trace_id: { order: "asc" } }], // Simple sort by trace_id only
          _source: ["trace_id", "spans.metrics.cost"],
        };

        searchResponse = await client.search({
          index: TRACE_INDEX.alias,
          body: searchBody,
        });
      } catch (error) {
        logger.error(
          { error, projectId },
          "Failed to search for traces in project, skipping"
        );
        break;
      }

      const traces = searchResponse.hits.hits;
      if (traces.length === 0) break;

      logger.info(
        { projectId, traceCount: traces.length, from },
        "Found traces with span costs"
      );

      // Prepare bulk operations
      const bulkActions: any[] = [];
      let bulkProcessedCount = 0;

      // Process each trace
      for (const hit of traces) {
        const traceId = (hit._source as any).trace_id;
        const spans = (hit._source as any).spans || [];

        // Skip if no trace ID or spans
        if (!traceId || !Array.isArray(spans)) {
          logger.warn({ projectId, traceId }, "Invalid trace data, skipping");
          continue;
        }

        try {
          // Calculate total cost from spans
          let totalCost = 0;
          let hasValidCosts = false;

          for (const span of spans) {
            if (
              span.metrics?.cost !== null &&
              span.metrics?.cost !== undefined
            ) {
              totalCost += span.metrics.cost;
              hasValidCosts = true;
            }
          }

          // Only add to bulk operations if we found valid costs
          if (hasValidCosts) {
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
                  // Calculate total cost from all spans
                  double totalCost = 0.0;
                  boolean hasValidCosts = false;
                  
                  if (ctx._source.containsKey('spans') && ctx._source.spans instanceof List) {
                    for (span in ctx._source.spans) {
                      if (span != null && 
                          span.containsKey('metrics') && 
                          span.metrics != null && 
                          span.metrics.containsKey('cost') && 
                          span.metrics.cost != null) {
                        totalCost += span.metrics.cost;
                        hasValidCosts = true;
                      }
                    }
                  }
                  
                  // Update trace metrics
                  if (hasValidCosts) {
                    if (!ctx._source.containsKey('metrics')) {
                      ctx._source.metrics = new HashMap();
                    }
                    ctx._source.metrics.total_cost = totalCost;
                  } else {
                    // If no valid costs found, set to null
                    if (ctx._source.containsKey('metrics')) {
                      ctx._source.metrics.total_cost = null;
                    }
                  }
                `,
                lang: "painless",
              },
            });

            bulkProcessedCount++;
          }

          processedCount++;
          totalProcessedCount++;

          // Execute bulk operations when batch size is reached
          if (bulkActions.length >= bulkBatchSize * 2) {
            try {
              const bulkResult = await client.bulk({ body: bulkActions });
              if (bulkResult.errors) {
                logger.error(
                  { projectId, bulkResult },
                  "Bulk operation had errors"
                );
                consecutiveFailures++;
              } else {
                updatedCount += bulkProcessedCount;
                consecutiveFailures = 0; // Reset consecutive failures on success
              }
            } catch (bulkError) {
              consecutiveFailures++;
              logger.error(
                { bulkError, projectId, consecutiveFailures },
                "Failed to execute bulk update"
              );
            }

            // Stop processing if too many consecutive failures
            if (consecutiveFailures >= maxConsecutiveFailures) {
              logger.error(
                { projectId, consecutiveFailures },
                "Too many consecutive failures, stopping processing for this project"
              );
              break;
            }

            // Reset bulk operations
            bulkActions.length = 0;
            bulkProcessedCount = 0;
          }

          if (processedCount % 100 === 0) {
            logger.info(
              { projectId, processedCount, updatedCount },
              "Processed traces for project"
            );
          }
        } catch (error) {
          logger.error(
            { error, projectId, traceId },
            "Failed to process trace"
          );
        }
      }

      // Execute remaining bulk operations
      if (bulkActions.length > 0) {
        try {
          const bulkResult = await client.bulk({ body: bulkActions });
          if (bulkResult.errors) {
            logger.error(
              { projectId, bulkResult },
              "Bulk operation had errors"
            );
          } else {
            updatedCount += bulkProcessedCount;
          }
        } catch (bulkError) {
          logger.error(
            { bulkError, projectId },
            "Failed to execute final bulk update"
          );
        }
      }

      // Update offset for next iteration
      from += traces.length;

      // Break if we've had too many consecutive failures
      if (consecutiveFailures >= maxConsecutiveFailures) {
        break;
      }
    }

    totalUpdatedCount += updatedCount;
    logger.info(
      { projectId, processedCount, updatedCount },
      "Finished processing project"
    );
  }

  logger.info(
    {
      totalProcessedCount,
      totalUpdatedCount,
      totalProjects: projects.length,
    },
    "Finished syncing all trace costs"
  );
}
