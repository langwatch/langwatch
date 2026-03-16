import { appendFile, writeFile } from "node:fs/promises";
import type { Event } from "~/server/event-sourcing/domain/types.js";
import { processCommand } from "~/server/event-sourcing/services/commands/commandDispatcher.js";
import type { EventSourcingService } from "~/server/event-sourcing/services/eventSourcingService.js";
import type { EventRecord } from "~/server/event-sourcing/stores/repositories/eventRepository.types.js";
import type { EsScanner } from "./esScanner.js";
import type { ExistenceChecker } from "./existenceChecker.js";
import type {
  ClickHouseHealth,
  CommandToProcess,
  CursorStore,
  DirectWriteResult,
  EsHit,
  EsStats,
  Logger,
  MigrationConfig,
  MigrationDefinition,
  MigrationStats,
} from "./types.js";

const CH_MAX_PARTS_PER_PARTITION = 1500;
const CH_POLL_INTERVAL_MS = 2_000;

interface MigratorDeps {
	scanner: EsScanner;
	existenceChecker: ExistenceChecker;
	cursorStore: CursorStore;
	clickhouse: ClickHouseHealth;
	config: MigrationConfig;
	logger: Logger;
	/** The service from the registered pipeline — provides storeEvents (events + projections). */
	service: EventSourcingService<Event, any>;
	definition: MigrationDefinition;
	/** Flush buffered ClickHouse inserts — called at batch boundaries. */
	flushClickHouse: () => Promise<void>;
	/** Bulk-insert event records directly to event_log (for direct-write path). */
	insertEventRecords?: (records: EventRecord[]) => Promise<void>;
}

export class Migrator {
	private stopping = false;
	private paused = false;
	private resumeResolve: (() => void) | null = null;

	constructor(private readonly deps: MigratorDeps) {}

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
			service,
			definition,
			flushClickHouse,
		} = this.deps;

		this.registerShutdownHandlers();
		this.registerPauseHandler();

		// Truncate dry-run output file if present
		const dryRunFile = config.dryRun ? config.dryRunOutputFile : undefined;
		let dryRunRecordCount = 0;
		if (dryRunFile) {
			await writeFile(dryRunFile, "[\n");
			logger.info("Dry-run output file", { path: dryRunFile });
		}

		const cursor = await cursorStore.load();
		const from = cursor
			? new Date(cursor.lastEventTimestamp).toISOString()
			: "beginning";
		process.stderr.write(`  Starting from: ${from}\n\n`);

		const stats: MigrationStats = {
			total: 0,
			dispatched: 0,
			skipped: 0,
			duplicates: 0,
			errors: 0,
		};

		const tsField =
			definition.timestampField ?? Object.keys(definition.esSort[0]!)[0]!;
		const batchIterator = scanner.scanWithPrefetch(cursor);
		let batchCount = 0;

		for await (const batch of batchIterator) {
			if (this.stopping) {
				logger.info(
					"Graceful shutdown requested — exiting after current batch",
				);
				break;
			}

			const batchStartTime = Date.now();

			// ClickHouse backpressure
			const chHealth = await this.checkClickHouseHealth(clickhouse, logger);

			// Collect aggregate IDs grouped by tenant for scoped existence check
			const tenantAggregates = definition.getTenantAggregates(batch.events);

			// Check which ones already exist in ClickHouse (event_log is source of truth)
			const chQueryStart = Date.now();
			const existingByTenant =
				await existenceChecker.findExisting(tenantAggregates);
			const chQueryMs = Date.now() - chQueryStart;

			// Helper: check if a single event's aggregate exists (tenant-scoped)
			const isExisting = (e: EsHit): boolean => {
				const perEvent = definition.getTenantAggregates([e]);
				for (const [tenantId, aggIds] of perEvent) {
					const tenantExisting = existingByTenant.get(tenantId);
					if (!tenantExisting) return false;
					for (const aggId of aggIds) {
						if (!tenantExisting.has(aggId)) return false;
					}
				}
				return true;
			};

			// Split events: new vs already-processed (skip duplicates entirely)
			let batchDuplicates = 0;
			const newEvents: EsHit[] = [];
			for (const e of batch.events) {
				stats.total++;
				if (isExisting(e)) {
					batchDuplicates++;
					stats.duplicates++;
				} else {
					newEvents.push(e);
				}
			}

			// --- Process aggregates ---
			let batchInsertFailed = false;
			const useDirectWrite = !!definition.processAggregate;

			if (useDirectWrite) {
				// Direct-write path: processAggregate returns event records + projection writes
				const aggregates = definition.aggregate(
					config.dryRun ? batch.events : newEvents,
				);

				if (config.dryRun) {
					for (const [aggregateId, document] of aggregates) {
						let result: DirectWriteResult;
						try {
							result = definition.processAggregate!(document, aggregateId);
						} catch (err) {
							logger.warn("processAggregate failed (dry-run)", {
								aggregateId,
								error: err instanceof Error ? err.message : String(err),
							});
							stats.errors++;
							continue;
						}
						stats.dispatched += result.commandCount;

						if (dryRunFile) {
							const prefix = dryRunRecordCount > 0 ? ",\n" : "";
							const record = {
								aggregateId,
								esInput: document,
								eventRecords: result.eventRecords,
								projectionState: result.projectionState ?? null,
							};
							await appendFile(
								dryRunFile,
								prefix + JSON.stringify(record, null, 2),
							);
							dryRunRecordCount++;
						}
					}
				} else if (newEvents.length > 0) {
					// Process aggregates in sub-batches to bound peak memory.
					// Each aggregate (especially traces-combined) expands into many
					// EventRecord objects + projection closures; processing all at
					// once can OOM on large batches.
					const aggregateEntries = [...aggregates.entries()];
					const aggregatesWithoutCommands: string[] = [];

					for (let subIdx = 0; subIdx < aggregateEntries.length; subIdx += config.subBatchSize) {
						if (batchInsertFailed) break;

						const chunk = aggregateEntries.slice(subIdx, subIdx + config.subBatchSize);
						const chunkEventRecords: EventRecord[] = [];
						const chunkProjectionWrites: Array<() => Promise<void>> = [];

						for (const [aggregateId, document] of chunk) {
							let result: DirectWriteResult;
							try {
								result = definition.processAggregate!(document, aggregateId);
							} catch (err) {
								logger.warn("processAggregate failed", {
									aggregateId,
									error: err instanceof Error ? err.message : String(err),
								});
								stats.errors++;
								continue;
							}

							if (result.commandCount === 0) {
								aggregatesWithoutCommands.push(aggregateId);
								stats.skipped++;
								continue;
							}

							chunkEventRecords.push(...result.eventRecords);
							chunkProjectionWrites.push(...result.projectionWrites);
							stats.dispatched += result.commandCount;
						}

						// Bulk-insert this sub-batch's event records
						if (chunkEventRecords.length > 0 && this.deps.insertEventRecords) {
							try {
								await this.deps.insertEventRecords(chunkEventRecords);
							} catch (err) {
								logger.error("Failed to bulk-insert event records — skipping remaining sub-batches", {
									count: chunkEventRecords.length,
									error: err instanceof Error ? err.message : String(err),
								});
								stats.errors++;
								batchInsertFailed = true;
								break;
							}
						}

						// Execute this sub-batch's projection writes
						if (chunkProjectionWrites.length > 0) {
							await Promise.all(chunkProjectionWrites.map((fn) => fn()));
						}
						// chunkEventRecords + chunkProjectionWrites go out of scope → GC
					}

					if (aggregatesWithoutCommands.length > 0) {
						logger.warn("Skipped aggregates that produced no commands", {
							count: aggregatesWithoutCommands.length,
							sample: aggregatesWithoutCommands.slice(0, 5),
						});
					}

				}
			} else {
				// Command-based path: buildCommands + processCommand
				if (!config.dryRun && newEvents.length > 0) {
					const aggregates = definition.aggregate(newEvents);
					const aggregateEntries = [...aggregates.entries()];
					const aggregatesWithoutStart: string[] = [];

					await runPool(
						aggregateEntries,
						config.concurrency,
						async ([aggregateId, document]) => {
							let commands: CommandToProcess[];
							try {
								commands = definition.buildCommands(document);
							} catch (err) {
								logger.warn("Failed to build commands for aggregate", {
									aggregateId,
									error: err instanceof Error ? err.message : String(err),
								});
								stats.errors++;
								return;
							}

							if (commands.length === 0) {
								aggregatesWithoutStart.push(aggregateId);
								stats.skipped++;
								return;
							}

							for (const cmd of commands) {
								try {
									// Wrap storeEventsFn to stamp deterministic idempotency key
									const wrappedStore = createIdempotentStoreEvents(
										service.storeEvents.bind(service),
										cmd.idempotencyKey,
									);
									await processCommand({
										payload: cmd.payload,
										commandType: cmd.commandType as any,
										commandSchema: cmd.commandSchema,
										handler: cmd.handler,
										getAggregateId: cmd.getAggregateId,
										storeEventsFn: wrappedStore,
										aggregateType: definition.aggregateType as any,
										commandName: cmd.commandName,
									});
									stats.dispatched++;
								} catch (err) {
									stats.errors++;
									logger.error("processCommand failed", {
										aggregateId,
										commandName: cmd.commandName,
										error: err instanceof Error ? err.message : String(err),
									});
								}
							}
						},
					);

					if (aggregatesWithoutStart.length > 0) {
						logger.warn("Skipped aggregates that produced no commands", {
							count: aggregatesWithoutStart.length,
							sample: aggregatesWithoutStart.slice(0, 5),
						});
					}
				}

				// --- Dry run (command path): capture events + compute projections ---
				if (config.dryRun) {
					const aggregates = definition.aggregate(batch.events);
					for (const [aggregateId, document] of aggregates) {
						const commands = definition.buildCommands(document);
						stats.dispatched += commands.length;

						if (dryRunFile) {
							const capturedEvents: Event[] = [];

							for (const cmd of commands) {
								try {
									const capturingStore = createIdempotentStoreEvents(
										async (events: Event[]) => {
											capturedEvents.push(...events);
										},
										cmd.idempotencyKey,
									);
									await processCommand({
										payload: cmd.payload,
										commandType: cmd.commandType as any,
										commandSchema: cmd.commandSchema,
										handler: cmd.handler,
										getAggregateId: cmd.getAggregateId,
										storeEventsFn: capturingStore as any,
										aggregateType: definition.aggregateType as any,
										commandName: cmd.commandName,
									});
								} catch (err) {
									logger.warn("Dry-run processCommand failed", {
										aggregateId,
										commandName: cmd.commandName,
										error: err instanceof Error ? err.message : String(err),
									});
								}
							}

							// Compute fold projection state in memory
							const projectionState =
								definition.computeProjection?.(capturedEvents) ?? null;

							const prefix = dryRunRecordCount > 0 ? ",\n" : "";
							const record = {
								aggregateId,
								esInput: document,
								commands: commands.map((c) => ({
									commandName: c.commandName,
									commandType: c.commandType,
									payload: c.payload,
								})),
								events: capturedEvents.map(serializeEvent),
								projectionState,
							};
							await appendFile(
								dryRunFile,
								prefix + JSON.stringify(record, null, 2),
							);
							dryRunRecordCount++;
						}
					}
				}
			}

			// Flush buffered ClickHouse inserts before persisting cursor
			if (!config.dryRun) {
				await flushClickHouse();
			}

			// Persist cursor (only if batch fully succeeded)
			if (!config.dryRun && batch.events.length > 0 && !batchInsertFailed) {
				const lastEvent = batch.events[batch.events.length - 1]!;
				await cursorStore.save({
					lastEventTimestamp: getNestedField(lastEvent, tsField) as number,
					lastEventId: lastEvent._id,
					sortValues: batch.sortValues,
				});
			}

			// Per-batch progress
			const firstTs = getNestedField(batch.events[0]!, tsField) as
				| number
				| undefined;
			const lastTs = getNestedField(
				batch.events[batch.events.length - 1]!,
				tsField,
			) as number | undefined;
			const batchStart = firstTs ? new Date(firstTs).toISOString() : "?";
			const batchEnd = lastTs ? new Date(lastTs).toISOString() : "?";
			const dispLabel = config.dryRun ? "would_dispatch" : "dispatched";
			const elapsedMs = Date.now() - batchStartTime;
			const chInfo =
				chHealth.activeMerges > 0
					? ` ch_parts=${chHealth.maxPartsPerPartition} merges=${chHealth.activeMerges}(${chHealth.mergeMemoryMB}MB)`
					: ` ch_parts=${chHealth.maxPartsPerPartition}`;
			const progressPct =
				preflightStats && preflightStats.totalEvents > 0
					? ` ${((stats.total / preflightStats.totalEvents) * 100).toFixed(1)}%`
					: "";
			process.stderr.write(
				`  [${batchStart} → ${batchEnd}] batch=${batch.events.length}` +
					` ${dispLabel}=${stats.dispatched} dup=${stats.duplicates}` +
					` skip=${stats.skipped} err=${stats.errors} total=${stats.total}${progressPct}` +
					` (${elapsedMs}ms, ch_query=${chQueryMs}ms)${chInfo}\n`,
			);

			batchCount++;

			// Stop if maxEvents limit reached
			if (config.maxEvents && stats.total >= config.maxEvents) {
				logger.info("Max events limit reached — stopping", {
					maxEvents: config.maxEvents,
					total: stats.total,
				});
				break;
			}

			// Stop if maxBatches limit reached
			if (config.maxBatches && batchCount >= config.maxBatches) {
				logger.info("Max batches limit reached — stopping", {
					maxBatches: config.maxBatches,
					batchCount,
				});
				break;
			}

			// Delay between batches (skip for all-duplicate batches)
			if (
				config.delayBetweenBatchesMs > 0 &&
				batchDuplicates < batch.events.length
			) {
				await sleep(config.delayBetweenBatchesMs);
			}

			// Pause gate
			if (this.paused) {
				logger.info("Paused — press [p] to resume");
				await new Promise<void>((resolve) => {
					this.resumeResolve = resolve;
				});
				logger.info("Resumed");
			}
		}

		// Flush remaining buffered aggregates
		if (definition.flush) {
			const remaining = definition.flush();
			if (remaining.size > 0) {
				logger.info("Flushing remaining buffered aggregates", {
					count: remaining.size,
				});

				if (definition.processAggregate) {
					// Direct-write flush: sub-batched like the main loop
					const remainingEntries = [...remaining.entries()];

					for (let subIdx = 0; subIdx < remainingEntries.length; subIdx += config.subBatchSize) {
						const chunk = remainingEntries.slice(subIdx, subIdx + config.subBatchSize);
						const chunkEventRecords: EventRecord[] = [];
						const chunkProjectionWrites: Array<() => Promise<void>> = [];

						for (const [aggregateId, document] of chunk) {
							let result: DirectWriteResult;
							try {
								result = definition.processAggregate!(document, aggregateId);
							} catch (err) {
								logger.warn("processAggregate failed (flush)", {
									aggregateId,
									error: err instanceof Error ? err.message : String(err),
								});
								stats.errors++;
								continue;
							}

							if (result.commandCount === 0) {
								stats.skipped++;
								continue;
							}

							chunkEventRecords.push(...result.eventRecords);
							chunkProjectionWrites.push(...result.projectionWrites);
							stats.dispatched += result.commandCount;
						}

						if (
							!config.dryRun &&
							chunkEventRecords.length > 0 &&
							this.deps.insertEventRecords
						) {
							try {
								await this.deps.insertEventRecords(chunkEventRecords);
							} catch (err) {
								logger.error("Failed to bulk-insert event records (flush)", {
									count: chunkEventRecords.length,
									error: err instanceof Error ? err.message : String(err),
								});
								stats.errors++;
							}
						}

						if (!config.dryRun && chunkProjectionWrites.length > 0) {
							await Promise.all(chunkProjectionWrites.map((fn) => fn()));
						}
					}
				} else {
					// Command-based flush
					for (const [aggregateId, document] of remaining) {
						if (config.dryRun) {
							const commands = definition.buildCommands(document);
							stats.dispatched += commands.length;
							if (dryRunFile) {
								const capturedEvents: Event[] = [];

								for (const cmd of commands) {
									try {
										const capturingStore = createIdempotentStoreEvents(
											async (events: Event[]) => {
												capturedEvents.push(...events);
											},
											cmd.idempotencyKey,
										);
										await processCommand({
											payload: cmd.payload,
											commandType: cmd.commandType as any,
											commandSchema: cmd.commandSchema,
											handler: cmd.handler,
											getAggregateId: cmd.getAggregateId,
											storeEventsFn: capturingStore as any,
											aggregateType: definition.aggregateType as any,
											commandName: cmd.commandName,
										});
									} catch (err) {
										logger.warn("Dry-run processCommand failed (flush)", {
											aggregateId,
											commandName: cmd.commandName,
											error: err instanceof Error ? err.message : String(err),
										});
									}
								}

								const projectionState =
									definition.computeProjection?.(capturedEvents) ?? null;

								const prefix = dryRunRecordCount > 0 ? ",\n" : "";
								const record = {
									aggregateId,
									esInput: document,
									commands: commands.map((c) => ({
										commandName: c.commandName,
										commandType: c.commandType,
										payload: c.payload,
									})),
									events: capturedEvents.map(serializeEvent),
									projectionState,
								};
								await appendFile(
									dryRunFile,
									prefix + JSON.stringify(record, null, 2),
								);
								dryRunRecordCount++;
							}
							continue;
						}
						const commands = definition.buildCommands(document);
						if (commands.length === 0) {
							logger.warn(
								"Flushed aggregate produced no commands (missing start event?)",
								{
									aggregateId,
								},
							);
							stats.skipped++;
							continue;
						}

						for (const cmd of commands) {
							try {
								const wrappedStore = createIdempotentStoreEvents(
									service.storeEvents.bind(service),
									cmd.idempotencyKey,
								);
								await processCommand({
									payload: cmd.payload,
									commandType: cmd.commandType as any,
									commandSchema: cmd.commandSchema,
									handler: cmd.handler,
									getAggregateId: cmd.getAggregateId,
									storeEventsFn: wrappedStore,
									aggregateType: definition.aggregateType as any,
									commandName: cmd.commandName,
								});
								stats.dispatched++;
							} catch (err) {
								stats.errors++;
								logger.error("processCommand failed (flush)", {
									aggregateId,
									commandName: cmd.commandName,
									error: err instanceof Error ? err.message : String(err),
								});
							}
						}
					}
				}
			}
		}

		// Final flush of any remaining buffered CH inserts
		if (!config.dryRun) {
			await flushClickHouse();
		}

		// Close the JSON array in the dry-run output file
		if (dryRunFile) {
			await appendFile(dryRunFile, "\n]\n");
		}

		this.teardownPauseHandler();
		this.teardownShutdownHandlers();
		logger.info(
			"Migration complete",
			stats as unknown as Record<string, unknown>,
		);
		return stats;
	}

	private async checkClickHouseHealth(
		clickhouse: ClickHouseHealth,
		logger: Logger,
		threshold = CH_MAX_PARTS_PER_PARTITION,
	): Promise<ClickHouseHealthInfo> {
		let warned = false;

		while (true) {
			let info: ClickHouseHealthInfo;
			try {
				info = await getClickHouseHealth(clickhouse);
			} catch (err) {
				logger.warn("ClickHouse health check failed — retrying", {
					error: err instanceof Error ? err.message : String(err),
				});
				if (this.stopping)
					return { maxPartsPerPartition: 0, activeMerges: 0, mergeMemoryMB: 0 };
				await sleep(CH_POLL_INTERVAL_MS);
				continue;
			}

			if (info.maxPartsPerPartition < threshold) {
				if (warned) {
					logger.info("ClickHouse back to safe level", {
						maxPartsPerPartition: info.maxPartsPerPartition,
						activeMerges: info.activeMerges,
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

	private shutdownHandler: (() => void) | null = null;

	private registerShutdownHandlers(): void {
		let signalCount = 0;
		this.shutdownHandler = () => {
			signalCount++;
			this.stopping = true;
			if (signalCount === 1) {
				this.deps.logger.info(
					"Shutdown signal received — finishing current batch (press again to force quit)",
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
						"Pause requested — will pause after current batch",
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

interface ClickHouseHealthInfo {
	maxPartsPerPartition: number;
	activeMerges: number;
	mergeMemoryMB: number;
}

async function getClickHouseHealth(
	clickhouse: ClickHouseHealth,
): Promise<ClickHouseHealthInfo> {
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

/** Serialize an event for dry-run output, stripping internal handler references. */
function serializeEvent(event: Event): Record<string, unknown> {
	return {
		id: event.id,
		type: event.type,
		version: event.version,
		aggregateType: event.aggregateType,
		aggregateId: event.aggregateId,
		tenantId: event.tenantId,
		createdAt: event.createdAt,
		occurredAt: event.occurredAt,
		data: event.data,
	};
}

/** Resolve a dot-separated field path like "timestamps.created_at" on an object. */
function getNestedField(obj: Record<string, unknown>, path: string): unknown {
	let current: unknown = obj;
	for (const key of path.split(".")) {
		if (current == null || typeof current !== "object") return undefined;
		current = (current as Record<string, unknown>)[key];
	}
	return current;
}

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Wraps a storeEvents function to stamp a deterministic idempotency key
 * on every event before passing to the inner store. This ensures that
 * re-processing the same ES document produces events with identical keys.
 */
function createIdempotentStoreEvents(
	inner: (...args: any[]) => Promise<void>,
	idempotencyKey: string,
): (...args: any[]) => Promise<void> {
	return async (...args: any[]) => {
		const events = args[0] as Event[];
		for (const event of events) {
			event.idempotencyKey = idempotencyKey;
		}
		return inner(...args);
	};
}

async function runPool<T>(
	items: T[],
	concurrency: number,
	fn: (item: T) => Promise<void>,
): Promise<void> {
	let idx = 0;

	async function worker(): Promise<void> {
		while (idx < items.length) {
			const item = items[idx++]!;
			await fn(item);
		}
	}

	const workers = Array.from(
		{ length: Math.min(concurrency, items.length) },
		() => worker(),
	);
	await Promise.all(workers);
}
