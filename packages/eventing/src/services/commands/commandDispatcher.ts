import { performance } from "node:perf_hooks";
import type { createLogger } from "@langwatch/observability";
import { incrementEsCommandTotal, observeEsCommandDuration } from "../../metrics";
import { mapValidationIssues } from "../../utils/errors";
import type { Command, CommandHandler } from "../../commands/command";
import { createCommand } from "../../commands/command";
import type { CommandSchema } from "../../commands/commandSchema";
import type { AggregateType } from "../../domain/aggregateType";
import type { CommandType } from "../../domain/commandType";
import type { TenantId } from "../../domain/tenantId";
import { createTenantId } from "../../domain/tenantId";
import type { Event } from "../../domain/types";
import { EventSchema } from "../../domain/types";
import type { CommandSerializationOptions } from "../../pipeline/staticBuilder.types";
import type { DeduplicationStrategy } from "../../queues";
import type { EventStoreReadContext } from "../../stores/eventStore.types";
import { EventUtils } from "../../utils/event.utils";
import { ValidationError } from "../errorHandling";

/**
 * Constraint interface for payloads that support command processing.
 * All command payloads must include a tenantId for tenant isolation
 * and occurredAt for global FIFO ordering.
 */

/**
 * Parameters for the extracted processCommand function.
 */
export interface ProcessCommandParams<EventType extends Event> {
  payload: Record<string, unknown>;
  commandType: CommandType;
  commandSchema: CommandSchema<any, CommandType>;
  handler: CommandHandler<Command<any>, EventType>;
  getAggregateId: (payload: any) => string;
  storeEventsFn: (events: EventType[], context: EventStoreReadContext<EventType>) => Promise<void>;
  aggregateType: AggregateType;
  commandName: string;
  pipelineName: string;
  logger?: ReturnType<typeof createLogger>;
}

/**
 * Validates that a command handler returned a defined array of well-formed
 * events, throwing a {@link ValidationError} otherwise.
 *
 * Extracted so {@link processCommand} and {@link processCommandBatch} reject
 * identical malformed handler output rather than each carrying its own copy.
 */
function validateHandlerEvents(events: unknown, commandType: CommandType): void {
  if (!events) {
    throw new ValidationError(
      `Command handler for "${commandType}" returned undefined. Handler must return an array of events.`,
      "events",
      void 0,
      { commandType },
    );
  }

  if (!Array.isArray(events)) {
    throw new ValidationError(
      `Command handler for "${commandType}" returned a non-array value. Handler must return an array of events, but got: ${typeof events}`,
      "events",
      undefined,
      { commandType },
    );
  }

  for (let i = 0; i < events.length; i++) {
    const event = events[i];
    if (!event) {
      throw new ValidationError(
        `Command handler for "${commandType}" returned an array with undefined at index ${i}. All events must be defined.`,
        "events",
        undefined,
        { commandType, index: i },
      );
    }

    if (!EventUtils.isValidEvent(event)) {
      const parseResult = EventSchema.safeParse(event);
      const validationError =
        parseResult.success === false
          ? `Validation errors: ${parseResult.error.issues
              .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
              .join(", ")}`
          : "Unknown validation error";

      throw new ValidationError(
        `Command handler for "${commandType}" returned an invalid event at index ${i}. Event must have id, aggregateId, timestamp, type, and data. ${validationError}.`,
        "events",
        undefined,
        {
          commandType,
          index: i,
          zodIssues:
            parseResult.success === false ? mapValidationIssues(parseResult.error.issues) : void 0,
        },
      );
    }
  }
}

/**
 * Processes a command: validates the payload, invokes the handler,
 * validates resulting events, and stores them.
 *
 * Extracted from createCommandDispatcher to allow reuse in shared command queues.
 */
export async function processCommand<EventType extends Event>(
  params: ProcessCommandParams<EventType>,
): Promise<void> {
  const {
    payload,
    commandType,
    commandSchema,
    handler,
    getAggregateId,
    storeEventsFn,
    aggregateType,
    commandName,
    pipelineName,
    logger: log,
  } = params;

  const validation = commandSchema.validate(payload);
  if (!validation.success) {
    throw new ValidationError(
      `Invalid payload for command type "${commandType}". Validation failed.`,
      "payload",
      undefined,
      {
        commandType,
        zodIssues: mapValidationIssues(validation.error.issues),
      },
    );
  }

  const validated = validation.data;
  const tenantId = createTenantId(String(validated.tenantId));
  const aggregateId = getAggregateId(validated);

  const command = createCommand(tenantId, aggregateId, commandType, validated);

  const commandStartTime = performance.now();
  try {
    const events = await handler.handle(command);

    validateHandlerEvents(events, commandType);

    if (events.length > 0) {
      await storeEventsFn(events, { tenantId });
      // ADR-022: Post-store cleanup. Invoked AFTER the event_log INSERT is durable.
      // Best-effort: errors are caught and logged, never rethrown — cleanup failure
      // must not roll back a successfully stored event. The canonical use case is
      // deleting the transient S3 spool that the edge created to carry an
      // over-threshold command payload.
      if (handler.cleanupAfterStore) {
        try {
          await handler.cleanupAfterStore(command);
        } catch (err) {
          log?.warn(
            {
              error: err instanceof Error ? err.message : String(err),
              commandType,
            },
            "Post-store cleanup failed (best-effort) — event is durable, cleanup skipped",
          );
        }
      }
    }

    const durationMs = performance.now() - commandStartTime;
    incrementEsCommandTotal(pipelineName, commandType, "completed");
    observeEsCommandDuration(pipelineName, commandType, durationMs);
  } catch (error) {
    const durationMs = performance.now() - commandStartTime;
    incrementEsCommandTotal(pipelineName, commandType, "failed");
    observeEsCommandDuration(pipelineName, commandType, durationMs);
    throw error;
  }
}

/**
 * Parameters for {@link processCommandBatch}: the same shape as
 * {@link ProcessCommandParams} but with an ordered list of payloads instead of
 * one.
 */
export interface ProcessCommandBatchParams<EventType extends Event> extends Omit<
  ProcessCommandParams<EventType>,
  "payload"
> {
  /** Same-command payloads to coalesce, in dispatch (occurredAt) order. */
  payloads: Record<string, unknown>[];
}

/**
 * Attempted-command counter shared with {@link processCommandBatch}'s catch
 * block. Held in a mutable ref so a mid-loop throw still exposes the partial
 * count for the failure metrics.
 */
interface BatchProgress {
  attempted: number;
}

/**
 * Schema-validate every payload up front (Phase 1). A failure throws (like the
 * single path), failing the whole batch; downstream idempotency keys make the
 * batch's retry safe.
 */
function validateBatchPayloads<EventType extends Event>(
  params: ProcessCommandBatchParams<EventType>,
): any[] {
  const { payloads, commandSchema, commandType } = params;
  return payloads.map((payload) => {
    const validation = commandSchema.validate(payload);
    if (!validation.success) {
      throw new ValidationError(
        `Invalid payload for command type "${commandType}". Validation failed.`,
        "payload",
        undefined,
        {
          commandType,
          zodIssues: mapValidationIssues(validation.error.issues),
        },
      );
    }
    return validation.data;
  });
}

/**
 * Resolve the single tenant for the batch, enforcing the defensive invariant
 * that a coalesced batch comes from ONE tenant-scoped group. A mismatch is an
 * upstream routing bug — fail loudly rather than write cross-tenant events
 * under one tenant's insert.
 */
function resolveBatchTenantId(args: {
  validatedPayloads: any[];
  commandType: CommandType;
}): TenantId {
  const { validatedPayloads, commandType } = args;
  const tenantId = createTenantId(String(validatedPayloads[0]!.tenantId));
  for (const validated of validatedPayloads) {
    if (createTenantId(String(validated.tenantId)) !== tenantId) {
      throw new ValidationError(
        `Coalesced batch for command type "${commandType}" mixes tenants. All payloads in one group share a tenant.`,
        "tenantId",
        undefined,
        { commandType },
      );
    }
  }
  return tenantId;
}

/**
 * Handle and collect events for every validated payload in dispatch order.
 * `progress.attempted` counts validated payloads so the
 * caller's metrics (and its catch block) see the count even on a mid-loop throw.
 */
async function handleBatchCommands<EventType extends Event>(args: {
  params: ProcessCommandBatchParams<EventType>;
  validatedPayloads: any[];
  progress: BatchProgress;
}): Promise<{ handledCommands: Command<any>[]; allEvents: EventType[] }> {
  const { params, validatedPayloads, progress } = args;
  const { getAggregateId, handler, commandType, aggregateType } = params;

  const handledCommands: Command<any>[] = [];
  const allEvents: EventType[] = [];
  for (const validated of validatedPayloads) {
    const payloadTenantId = createTenantId(String(validated.tenantId));
    const aggregateId = getAggregateId(validated);

    progress.attempted++;
    const command = createCommand(payloadTenantId, aggregateId, commandType, validated);
    const events = await handler.handle(command);
    validateHandlerEvents(events, commandType);
    // Only a command that contributed events is "handled" for cleanup
    // purposes, mirroring the single path's `if (events.length > 0)` gate. A
    // handler may legitimately return nothing — RecordMetricCorrelationCommand
    // drops a malformed exemplar that way — and running its post-store cleanup
    // off the back of some OTHER payload's successful append would release a
    // resource for a command that never became durable.
    if (events.length === 0) {
      continue;
    }
    handledCommands.push(command);
    for (const event of events) {
      allEvents.push(event);
    }
  }

  return { handledCommands, allEvents };
}

/**
 * Persist the batch in ONE multi-row append, then run each handled command's
 * best-effort post-store cleanup (ADR-022). An empty event set skips the store.
 * A cleanup failure is logged and swallowed — it must never roll back durable
 * events.
 */
async function persistBatch<EventType extends Event>(args: {
  params: ProcessCommandBatchParams<EventType>;
  tenantId: TenantId;
  allEvents: EventType[];
  handledCommands: Command<any>[];
}): Promise<void> {
  const { params, tenantId, allEvents, handledCommands } = args;
  const { handler, storeEventsFn, commandType, logger: log } = params;

  if (allEvents.length === 0) {
    return;
  }

  await storeEventsFn(allEvents, { tenantId });
  if (handler.cleanupAfterStore) {
    for (const command of handledCommands) {
      try {
        await handler.cleanupAfterStore(command);
      } catch (err) {
        log?.warn(
          {
            error: err instanceof Error ? err.message : String(err),
            commandType,
          },
          "Post-store cleanup failed (best-effort) — event is durable, cleanup skipped",
        );
      }
    }
  }
}

/**
 * Emit one counter increment and one duration sample per attempted command,
 * keeping counter and histogram 1:1 with the single path. The whole-batch time
 * is amortised across attempts so each sample carries a per-command time rather
 * than N-commands of it.
 */
function emitBatchMetrics<EventType extends Event>(args: {
  params: ProcessCommandBatchParams<EventType>;
  outcome: "completed" | "failed";
  attempted: number;
  durationMs: number;
}): void {
  const { params, outcome, attempted, durationMs } = args;
  const { pipelineName, commandType } = params;
  const perCommandMs = attempted > 0 ? durationMs / attempted : 0;
  for (let i = 0; i < attempted; i++) {
    incrementEsCommandTotal(pipelineName, commandType, outcome);
    observeEsCommandDuration(pipelineName, commandType, perCommandMs);
  }
}

/**
 * Batched sibling of {@link processCommand} (ADR-066 pillar 2).
 *
 * The GroupQueue drains a hot aggregate's queued same-command jobs and hands
 * them here as one ordered batch. Each payload is validated and handled in
 * dispatch order, then every resulting event is persisted in ONE
 * `storeEventsFn` call — collapsing N tiny single-row appends into one multi-row
 * insert so a high-fan-in producer stays off the per-item event-log write path.
 *
 * Contract — this is NOT the single path applied N times. All handlers run
 * BEFORE the single end-of-batch store, so a handler CANNOT read back its own (or
 * an earlier same-batch payload's) just-appended events — unlike the single path,
 * which stores between dispatches. Handlers coalesced here must therefore be
 * stateless per item: each derives its events from its own command alone, not
 * from same-batch appends. A command opting into `coalesceMaxBatch` must satisfy
 * this; one that needs read-your-writes within the batch must not coalesce.
 *
 * Because the drain only coalesces siblings sharing a `__jobName`, every payload
 * is the SAME command type: one schema and one handler serve the whole batch.
 *
 * Failure semantics mirror the single path:
 *  - a schema validation failure throws, failing the whole batch — the events
 *    carry idempotency keys, so the retry is de-duplicated downstream;
 *  - a handler error or malformed event fails the batch;
 *  - an empty event set skips the store call.
 */
export async function processCommandBatch<EventType extends Event>(
  params: ProcessCommandBatchParams<EventType>,
): Promise<void> {
  if (params.payloads.length === 0) {
    return;
  }

  const validatedPayloads = validateBatchPayloads(params);
  const tenantId = resolveBatchTenantId({
    validatedPayloads,
    commandType: params.commandType,
  });

  const batchStartTime = performance.now();
  const progress: BatchProgress = { attempted: 0 };
  try {
    const { handledCommands, allEvents } = await handleBatchCommands({
      params,
      validatedPayloads,
      progress,
    });
    await persistBatch({ params, tenantId, allEvents, handledCommands });
    emitBatchMetrics({
      params,
      outcome: "completed",
      attempted: progress.attempted,
      durationMs: performance.now() - batchStartTime,
    });
  } catch (error) {
    emitBatchMetrics({
      params,
      outcome: "failed",
      attempted: progress.attempted,
      durationMs: performance.now() - batchStartTime,
    });
    throw error;
  }
}

/**
 * Options for configuring a command handler.
 */
export interface CommandHandlerOptions<Payload> extends CommandSerializationOptions<Payload> {
  getAggregateId?: (payload: Payload) => string;
  getGroupKey?: (payload: Payload) => string;
  delay?: number;
  deduplication?: DeduplicationStrategy<Payload>;
  concurrency?: number;
  spanAttributes?: (payload: Payload) => Record<string, string | number | boolean>;
}
