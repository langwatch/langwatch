import { appendFile, writeFile } from "node:fs/promises";
import type { EventRecord } from "~/server/event-sourcing/stores/repositories/eventRepository.types.js";
import type { EsScanner } from "./esScanner.js";
import { ExistenceChecker } from "./existenceChecker.js";
import type {
  ClickHouseHealth,
  CursorStore,
  DirectWriteResult,
  DiscoveryMigrationDefinition,
  EsStats,
  Logger,
  MigrationConfig,
  MigrationStats,
} from "./types.js";

const CH_MAX_PARTS_PER_PARTITION = 1500;
const CH_POLL_INTERVAL_MS = 2_000;
const DEFAULT_WINDOW_SIZE_MS = 60 * 60 * 1000; // 1 hour
const MAX_WINDOW_SIZE_MS = 24 * 60 * 60 * 1000; // 24 hours cap
/**
 * Target number of new aggregates per window. If a window discovers fewer,
 * the next window doubles in size (up to MAX_WINDOW_SIZE_MS). If it discovers
 * more, the window shrinks back. This avoids wasting CH merges on windows
 * with very few aggregates.
 */
const TARGET_NEW_AGGREGATES = 600;

interface DiscoveryMigratorDeps {
  scanner: EsScanner;
  existenceChecker: ExistenceChecker;
  cursorStore: CursorStore;
  clickhouse: ClickHouseHealth;
  config: MigrationConfig;
  logger: Logger;
  definition: DiscoveryMigrationDefinition;
  flushClickHouse: () => Promise<void>;
  insertEventRecords?: (records: EventRecord[]) => Promise<void>;
  /** Time window size in ms for discovery (default: 1 hour). */
  windowSizeMs?: number;
}

export class DiscoveryMigrator {
  private stopping = false;
  private paused = false;
  private resumeResolve: (() => void) | null = null;

  constructor(private readonly deps: DiscoveryMigratorDeps) {}

  async run({
    preflightStats,
  }: {
    preflightStats?: EsStats;
  } = {}): Promise<MigrationStats> {
    const {
      scanner,
      existenceChecker,
      cursorStore,
      clickhouse,
      config,
      logger,
      definition,
      flushClickHouse,
    } = this.deps;
    const windowSizeMs = this.deps.windowSizeMs ?? DEFAULT_WINDOW_SIZE_MS;

    this.registerShutdownHandlers();
    this.registerPauseHandler();

    // Dry-run output file
    const dryRunFile = config.dryRun ? config.dryRunOutputFile : undefined;
    let dryRunRecordCount = 0;
    if (dryRunFile) {
      await writeFile(dryRunFile, "[\n");
      logger.info("Dry-run output file", { path: dryRunFile });
    }

    // Load cursor
    const cursor = await cursorStore.load();
    const startFrom =
      cursor?.lastEventTimestamp ??
      preflightStats?.minTimestamp ??
      0;
    const endAt = (preflightStats?.maxTimestamp ?? Date.now()) + 1; // +1 to include last ms

    const from = cursor
      ? new Date(cursor.lastEventTimestamp).toISOString()
      : "beginning";
    process.stderr.write(`  Starting from: ${from}\n`);
    process.stderr.write(
      `  Initial window: ${(windowSizeMs / 1000 / 60).toFixed(0)} minutes (adaptive)\n\n`,
    );

    // Seed done set from ClickHouse (composite keys: "tenantId:aggregateId")
    logger.info("Loading existing aggregate IDs from ClickHouse...");
    const doneSet = await existenceChecker.loadAllExisting();
    logger.info("Loaded existing aggregates", { count: doneSet.size });

    const stats: MigrationStats = {
      total: 0,
      dispatched: 0,
      skipped: 0,
      duplicates: 0,
      errors: 0,
    };

    let windowStart = startFrom;
    let windowCount = 0;
    let currentWindowMs = windowSizeMs;

    while (windowStart < endAt) {
      if (this.stopping) {
        logger.info("Graceful shutdown — exiting after current window");
        break;
      }

      const windowEnd = Math.min(windowStart + currentWindowMs, endAt);
      const batchStartTime = Date.now();
      let windowTimingMs: { fetch: number; process: number; write: number } | undefined;

      // ClickHouse backpressure
      const chHealth = await this.checkClickHouseHealth(clickhouse, logger);

      // Discover (tenantId, aggregateId) pairs in this time window
      const discovered = await scanner.discoverAggregates(
        windowStart,
        windowEnd,
        definition.tenantIdField,
      );
      const newAggregates = discovered.filter(
        (d) =>
          !doneSet.has(
            ExistenceChecker.compositeKey(d.tenantId, d.aggregateId),
          ),
      );
      const duplicateCount = discovered.length - newAggregates.length;
      stats.duplicates += duplicateCount;
      stats.total += discovered.length;

      let windowFailed = false;

      if (newAggregates.length > 0) {
        const processedKeys: string[] = [];
        let windowSkipped = 0;

        // Bulk-fetch all events for all new aggregates in one ES query
        const fetchStart = Date.now();
        const eventsByAggregate = await scanner.fetchBulkAggregateEvents(
          newAggregates,
          definition.tenantIdField,
          { from: windowStart, to: windowEnd },
        );
        const fetchMs = Date.now() - fetchStart;

        const allEventRecords: EventRecord[] = [];
        const allProjectionWrites: Array<() => Promise<void>> = [];

        const processStart = Date.now();
        for (const { tenantId, aggregateId } of newAggregates) {
          if (this.stopping) break;

          const key = ExistenceChecker.compositeKey(tenantId, aggregateId);
          const events = eventsByAggregate.get(key) ?? [];

          if (events.length === 0) {
            stats.skipped++;
            windowSkipped++;
            continue;
          }

          if (config.dryRun) {
            let result: DirectWriteResult;
            try {
              result = definition.processAggregate(events, aggregateId);
            } catch (err) {
              logger.warn("processAggregate failed (dry-run)", {
                aggregateId,
                tenantId,
                error: err instanceof Error ? err.message : String(err),
              });
              stats.errors++;
              continue;
            }

            stats.dispatched += result.commandCount;

            if (dryRunFile) {
              const prefix = dryRunRecordCount > 0 ? ",\n" : "";
              const record = {
                tenantId,
                aggregateId,
                eventCount: events.length,
                eventRecords: result.eventRecords,
                projectionState: result.projectionState ?? null,
              };
              await appendFile(
                dryRunFile,
                prefix + JSON.stringify(record, null, 2),
              );
              dryRunRecordCount++;
            }
            continue;
          }

          // Live mode: process and accumulate
          let result: DirectWriteResult;
          try {
            result = definition.processAggregate(events, aggregateId);
          } catch (err) {
            logger.warn("processAggregate failed", {
              aggregateId,
              tenantId,
              eventCount: events.length,
              error: err instanceof Error ? err.message : String(err),
            });
            stats.errors++;
            continue;
          }

          if (result.commandCount === 0) {
            stats.skipped++;
            windowSkipped++;
            continue;
          }

          allEventRecords.push(...result.eventRecords);
          allProjectionWrites.push(...result.projectionWrites);
          stats.dispatched += result.commandCount;
          processedKeys.push(key);
        }
        const processMs = Date.now() - processStart;

        // Bulk-insert event records
        const writeStart = Date.now();
        if (!config.dryRun && !windowFailed && allEventRecords.length > 0 && this.deps.insertEventRecords) {
          try {
            await this.deps.insertEventRecords(allEventRecords);
          } catch (err) {
            logger.error("Failed to bulk-insert event records", {
              count: allEventRecords.length,
              error: err instanceof Error ? err.message : String(err),
            });
            stats.errors++;
            windowFailed = true;
          }
        }
        // Release event records for GC before executing projection writes
        allEventRecords.length = 0;

        // Execute projection writes only if event insert succeeded
        if (!config.dryRun && !windowFailed && allProjectionWrites.length > 0) {
          await Promise.all(allProjectionWrites.map((fn) => fn()));
        }

        // Flush CH before saving cursor
        if (!config.dryRun && !windowFailed) {
          await flushClickHouse();
        }
        const writeMs = Date.now() - writeStart;

        // Only mark aggregates as done after successful write
        if (!windowFailed) {
          for (const key of processedKeys) {
            doneSet.add(key);
          }
        }

        // Store timing for progress output
        windowTimingMs = { fetch: fetchMs, process: processMs, write: writeMs };

        if (windowSkipped > 0) {
          logger.debug("Skipped aggregates in window", {
            count: windowSkipped,
          });
        }
      }

      // Save cursor only if window fully succeeded and wasn't interrupted
      if (!config.dryRun && !windowFailed && !this.stopping) {
        await cursorStore.save({ lastEventTimestamp: windowEnd });
      }

      // Adaptive window sizing: grow if too few new aggregates, shrink if too many
      const prevWindowMs = currentWindowMs;
      if (newAggregates.length < TARGET_NEW_AGGREGATES / 4 && currentWindowMs < MAX_WINDOW_SIZE_MS) {
        currentWindowMs = Math.min(currentWindowMs * 2, MAX_WINDOW_SIZE_MS);
      } else if (newAggregates.length > TARGET_NEW_AGGREGATES * 2 && currentWindowMs > windowSizeMs) {
        currentWindowMs = Math.max(Math.floor(currentWindowMs / 2), windowSizeMs);
      }

      // Progress output
      const elapsedMs = Date.now() - batchStartTime;
      const progressPct =
        endAt > startFrom
          ? (((windowEnd - startFrom) / (endAt - startFrom)) * 100).toFixed(1)
          : "100.0";
      const dispLabel = config.dryRun ? "would_dispatch" : "dispatched";
      const windowLabel = `${(prevWindowMs / 1000 / 60).toFixed(0)}m`;
      const windowChange =
        currentWindowMs !== prevWindowMs
          ? ` → ${(currentWindowMs / 1000 / 60).toFixed(0)}m`
          : "";
      const timingDetail = windowTimingMs
        ? ` [es=${windowTimingMs.fetch}ms proc=${windowTimingMs.process}ms ch=${windowTimingMs.write}ms]`
        : "";
      process.stderr.write(
        `  [${new Date(windowStart).toISOString()} → ${new Date(windowEnd).toISOString()}]` +
          ` w=${windowLabel}${windowChange}` +
          ` discovered=${discovered.length} new=${newAggregates.length} dup=${duplicateCount}` +
          ` ${dispLabel}=${stats.dispatched} skip=${stats.skipped} err=${stats.errors}` +
          ` ${progressPct}% (${elapsedMs}ms)${timingDetail}` +
          ` ch_parts=${chHealth.maxPartsPerPartition}\n`,
      );

      windowStart = windowEnd;
      windowCount++;

      // Stop if maxBatches (windows) reached
      if (config.maxBatches && windowCount >= config.maxBatches) {
        logger.info("Max batches (windows) reached", { windowCount });
        break;
      }

      // Stop if maxEvents reached
      if (config.maxEvents && stats.total >= config.maxEvents) {
        logger.info("Max events reached", { total: stats.total });
        break;
      }

      // Pause gate
      if (this.paused) {
        logger.info("Paused — press [p] to resume");
        await new Promise<void>((resolve) => {
          this.resumeResolve = resolve;
        });
        logger.info("Resumed");
      }

      if (config.delayBetweenBatchesMs > 0 && newAggregates.length > 0) {
        await sleep(config.delayBetweenBatchesMs);
      }
    }

    // Close dry-run output
    if (dryRunFile) {
      await appendFile(dryRunFile, "\n]\n");
    }

    this.teardownPauseHandler();
    this.teardownShutdownHandlers();
    logger.info(
      "Discovery migration complete",
      stats as unknown as Record<string, unknown>,
    );
    return stats;
  }

  // --- ClickHouse health check ---

  private async checkClickHouseHealth(
    clickhouse: ClickHouseHealth,
    logger: Logger,
    threshold = CH_MAX_PARTS_PER_PARTITION,
  ): Promise<{ maxPartsPerPartition: number; activeMerges: number; mergeMemoryMB: number }> {
    let warned = false;

    while (true) {
      let info: { maxPartsPerPartition: number; activeMerges: number; mergeMemoryMB: number };
      try {
        info = await getClickHouseHealth(clickhouse);
      } catch (err) {
        logger.warn("ClickHouse health check failed — retrying", {
          error: err instanceof Error ? err.message : String(err),
        });
        if (this.stopping) return { maxPartsPerPartition: 0, activeMerges: 0, mergeMemoryMB: 0 };
        await sleep(CH_POLL_INTERVAL_MS);
        continue;
      }

      if (info.maxPartsPerPartition < threshold) {
        if (warned) {
          logger.info("ClickHouse back to safe level", {
            maxPartsPerPartition: info.maxPartsPerPartition,
          });
        }
        return info;
      }

      if (!warned) {
        logger.warn("ClickHouse under pressure — pausing", {
          maxPartsPerPartition: info.maxPartsPerPartition,
          threshold,
          activeMerges: info.activeMerges,
          mergeMemoryMB: info.mergeMemoryMB,
        });
        warned = true;
      }

      if (this.stopping) return info;
      await sleep(CH_POLL_INTERVAL_MS);
    }
  }

  // --- Shutdown & pause handlers ---

  private shutdownHandler: (() => void) | null = null;

  private registerShutdownHandlers(): void {
    let signalCount = 0;
    this.shutdownHandler = () => {
      signalCount++;
      this.stopping = true;
      if (signalCount === 1) {
        this.deps.logger.info(
          "Shutdown signal received — finishing current window (press again to force quit)",
        );
      } else {
        this.deps.logger.warn("Force quit");
        process.exit(1);
      }
    };
    process.on("SIGINT", this.shutdownHandler);
    process.on("SIGTERM", this.shutdownHandler);
  }

  private teardownShutdownHandlers(): void {
    if (this.shutdownHandler) {
      process.removeListener("SIGINT", this.shutdownHandler);
      process.removeListener("SIGTERM", this.shutdownHandler);
      this.shutdownHandler = null;
    }
  }

  private stdinListener: ((data: Buffer) => void) | null = null;
  private ctrlCCount = 0;

  private registerPauseHandler(): void {
    if (!process.stdin.isTTY) return;

    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.setEncoding("utf8");

    this.stdinListener = (data: Buffer) => {
      const key = data.toString();

      if (key === "\u0003") {
        this.ctrlCCount++;
        this.stopping = true;
        if (this.resumeResolve) {
          this.resumeResolve();
          this.resumeResolve = null;
        }
        if (this.ctrlCCount >= 2) {
          this.deps.logger.warn("Force quit");
          process.exit(1);
        }
        this.deps.logger.info(
          "Ctrl+C — stopping after current operation (press again to force quit)",
        );
        return;
      }

      if (key === "p" || key === "P") {
        if (this.paused) {
          this.paused = false;
          if (this.resumeResolve) {
            this.resumeResolve();
            this.resumeResolve = null;
          }
        } else {
          this.paused = true;
          this.deps.logger.info(
            "Pause requested — will pause after current aggregate",
          );
        }
      }
    };

    process.stdin.on("data", this.stdinListener);
    this.deps.logger.info("Press [p] to pause/resume migration");
  }

  private teardownPauseHandler(): void {
    if (this.stdinListener) {
      process.stdin.removeListener("data", this.stdinListener);
      this.stdinListener = null;
    }
    if (process.stdin.isTTY) {
      process.stdin.setRawMode(false);
      process.stdin.pause();
    }
  }
}

async function getClickHouseHealth(
  clickhouse: ClickHouseHealth,
): Promise<{ maxPartsPerPartition: number; activeMerges: number; mergeMemoryMB: number }> {
  const [partsResult, mergesResult] = await Promise.all([
    clickhouse.query({
      query: `
        SELECT max(c) AS max_parts
        FROM (
          SELECT partition, count() AS c
          FROM system.parts
          WHERE database = 'langwatch'
            AND active = 1
          GROUP BY table, partition
        )
      `,
      format: "JSONEachRow",
    }),
    clickhouse.query({
      query: `
        SELECT
          count() AS active_merges,
          sum(memory_usage) AS total_memory
        FROM system.merges
        WHERE database = 'langwatch'
      `,
      format: "JSONEachRow",
    }),
  ]);

  const partsRows = await partsResult.json<{ max_parts: number }>();
  const mergesRows = await mergesResult.json<{
    active_merges: number;
    total_memory: number;
  }>();

  return {
    maxPartsPerPartition: partsRows[0]?.max_parts ?? 0,
    activeMerges: mergesRows[0]?.active_merges ?? 0,
    mergeMemoryMB: Math.round((mergesRows[0]?.total_memory ?? 0) / 1024 / 1024),
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
