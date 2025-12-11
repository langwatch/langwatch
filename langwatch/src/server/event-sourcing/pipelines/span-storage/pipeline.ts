import { eventSourcing } from "../../runtime";
import { StoreSpanCommand } from "./commands/storeSpanCommand";
import { SpanProjectionHandler } from "./projections";
import type { SpanProjection } from "./projections/spanProjection";
import type { SpanStorageEvent } from "./schemas/events";

/**
 * Span storage pipeline for handling individual span storage.
 *
 * This pipeline uses span-level aggregates (aggregateId = spanId).
 * Each span is stored as a single row in the ingested_spans table.
 *
 * @example
 * ```typescript
 * // Store a span
 * await spanStoragePipeline.commands.storeSpan.send({
 *   tenantId: "tenant_123",
 *   spanData: { ... },
 *   collectedAtUnixMs: Date.now(),
 * });
 * ```
 */
export const spanStoragePipeline = eventSourcing
  .registerPipeline<SpanStorageEvent, SpanProjection>()
  .withName("span_storage")
  .withAggregateType("span")
  .withProjection("span", SpanProjectionHandler)
  .withCommand("storeSpan", StoreSpanCommand)
  .build();

