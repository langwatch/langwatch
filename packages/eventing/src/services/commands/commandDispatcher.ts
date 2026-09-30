import { performance } from "node:perf_hooks";

import { createLogger } from "@langwatch/observability";

import type { Command, CommandHandler } from "../../commands/command.ts";
import { createCommand } from "../../commands/command.ts";
import type { CommandSchema } from "../../commands/commandSchema.ts";
import { eventIdempotencyKey } from "../../commands/idempotency-key.ts";
import type { TenantScopedPayload } from "../../commands/sealedCommand.ts";
import type { AggregateType } from "../../domain/aggregateType.ts";
import type { CommandType } from "../../domain/commandType.ts";
import type { TenantId } from "../../domain/tenantId.ts";
import { createTenantId } from "../../domain/tenantId.ts";
import type { Event } from "../../domain/types.ts";
import { EventSchema } from "../../domain/types.ts";
import {
  isComponentKilled,
  type KillSwitchOptions,
  type KillSwitch,
} from "../../kill-switch/index.ts";
import { incrementEsCommandTotal, observeEsCommandDuration } from "../../metrics.ts";
import type { CommandSerializationOptions } from "../../pipeline/staticBuilder.types.ts";
import type { DeduplicationStrategy } from "../../queues/index.ts";
import type { EventStoreReadContext } from "../../stores/eventStore.types.ts";
import { mapValidationIssues } from "../../utils/errors.ts";
import { EventUtils } from "../../utils/event.utils.ts";
import { QueuedCommandPayloadInvalidError, ValidationError } from "../errorHandling.ts";

const dispatchLogger = createLogger("langwatch:event-sourcing:command-dispatcher");

/**
 * Parameters for the extracted processCommand function.
 */
export interface ProcessCommandParams<
  EventType extends Event,
  Payload extends TenantScopedPayload,
> {
  /** Already parsed by the command's queue lane, its only dispatch-time validation (§9). */
  payload: Payload;
  commandType: CommandType;
  commandSchema: CommandSchema<Payload, CommandType>;
  handler: CommandHandler<Command<Payload>, EventType>;
  getAggregateId: (payload: Payload) => string;
  storeEventsFn: (events: EventType[], context: EventStoreReadContext<EventType>) => Promise<void>;
  aggregateType: AggregateType;
  commandName: string;
  pipelineName: string;
  killSwitch?: KillSwitch;
  killSwitchOptions?: KillSwitchOptions;
  logger?: ReturnType<typeof createLogger>;
  /** The queue job's stable id; a crash replay of the job carries the same one. */
  jobId?: string;
}

/**
 * Keys each event the handler left unkeyed on the command job's stable id, so
 * a crash replay's second append collapses onto the first in the event log.
 */
function keyEventsByJob<EventType extends Event>({
  events,
  jobId,
}: {
  events: readonly EventType[];
  jobId: string | undefined;
}): EventType[] {
  if (!jobId) return [...events];
  return events.map((event, index) =>
    event.idempotencyKey
      ? event
      : { ...event, idempotencyKey: eventIdempotencyKey({ commandId: jobId, index }) },
  );
}

/**
 * Validates a command handler's events are a well-formed array, throwing
 * {@link ValidationError} otherwise. Shared by {@link processCommand} and
 * {@link processCommandBatch} so they reject malformed output identically.
 */
function validateHandlerEvents(events: unknown, commandType: CommandType): void {
  if (!events) {
    throw new ValidationError({
      reason: `Command handler for "${commandType}" returned undefined. Handler must return an array of events.`,
      field: "events",
      value: void 0,
      context: { commandType },
    });
  }

  if (!Array.isArray(events)) {
    throw new ValidationError({
      reason: `Command handler for "${commandType}" returned a non-array value. Handler must return an array of events, but got: ${typeof events}`,
      field: "events",
      context: { commandType },
    });
  }

  for (let i = 0; i < events.length; i++) {
    const event = events[i];
    if (!event) {
      throw new ValidationError({
        reason: `Command handler for "${commandType}" returned an array with undefined at index ${i}. All events must be defined.`,
        field: "events",
        context: { commandType, index: i },
      });
    }

    if (!EventUtils.isValidEvent(event)) {
      const parseResult = EventSchema.safeParse(event);
      const validationError =
        parseResult.success === false
          ? `Validation errors: ${parseResult.error.issues
              .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
              .join(", ")}`
          : "Unknown validation error";

      throw new ValidationError({
        reason: `Command handler for "${commandType}" returned an invalid event at index ${i}. Event must have id, aggregateId, timestamp, type, and data. ${validationError}.`,
        field: "events",
        context: {
          commandType,
          index: i,
          zodIssues:
            parseResult.success === false ? mapValidationIssues(parseResult.error.issues) : void 0,
        },
      });
    }
  }
}

/** The ClickHouse router's refusal for a tenant it cannot resolve, read structurally by name. */
function isUnknownTenant(error: unknown): boolean {
  return error instanceof Error && error.name === "UnknownTenantError";
}

/**
 * Appends a command's events; a tenant that no longer resolves (its organisation was
 * deleted before the command ran) can never store, so the command completes as a logged
 * no-op instead of retrying into a blocked group (Alex, 2026-09-30).
 */
async function storeUnlessTenantGone<EventType extends Event>({
  storeEventsFn,
  events,
  tenantId,
  commandType,
  log,
}: {
  storeEventsFn: (events: EventType[], context: EventStoreReadContext<EventType>) => Promise<void>;
  events: EventType[];
  tenantId: TenantId;
  commandType: CommandType;
  log: ReturnType<typeof createLogger> | undefined;
}): Promise<void> {
  try {
    await storeEventsFn(events, { tenantId });
  } catch (error) {
    if (!isUnknownTenant(error)) throw error;
    (log ?? dispatchLogger).warn(
      { tenantId, commandType, dropped: events.length },
      "Command's tenant no longer resolves; completing it as a no-op",
    );
  }
}

/** Parses a queued payload once, at dispatch; a failure is refused non-retryably (dead-letter). */
export function parseQueuedCommandPayload<
  EventType extends Event,
  Payload extends TenantScopedPayload,
>(params: Omit<ProcessCommandParams<EventType, Payload>, "payload">, payload: unknown): Payload {
  const validation = params.commandSchema.validate(payload);
  if (validation.success) return validation.data;
  const identity = {
    pipelineName: params.pipelineName,
    commandName: params.commandName,
    commandType: params.commandType,
    issues: mapValidationIssues(validation.error.issues),
  };
  (params.logger ?? dispatchLogger).error(
    identity,
    "Queued command payload failed its schema at dispatch; refusing it so the queue dead-letters it",
  );
  throw new QueuedCommandPayloadInvalidError(identity);
}

/**
 * Processes a command: validates the payload, invokes the handler, validates
 * resulting events, and stores them. Extracted for reuse in shared command
 * queues.
 */
export async function processCommand<EventType extends Event, Payload extends TenantScopedPayload>(
  params: ProcessCommandParams<EventType, Payload>,
): Promise<void> {
  const {
    payload,
    commandType,
    handler,
    getAggregateId,
    storeEventsFn,
    aggregateType,
    commandName,
    pipelineName,
    killSwitch,
    killSwitchOptions,
    logger: log,
    jobId,
  } = params;

  const validated = payload;
  const tenantId = createTenantId(String(validated.tenantId));
  const aggregateId = getAggregateId(validated);

  if (
    await isComponentKilled({
      killSwitch,
      aggregateType,
      componentType: "command",
      componentName: commandName,
      tenantId,
      customKey: killSwitchOptions?.customKey,
      logger: log,
    })
  ) {
    return;
  }

  const command = createCommand({ tenantId, aggregateId, type: commandType, data: validated });

  const commandStartTime = performance.now();
  try {
    const handled = await handler.handle(command);

    validateHandlerEvents(handled, commandType);
    const events = keyEventsByJob({ events: handled, jobId });

    if (events.length > 0) {
      await storeUnlessTenantGone({ storeEventsFn, events, tenantId, commandType, log });
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
export interface ProcessCommandBatchParams<
  EventType extends Event,
  Payload extends TenantScopedPayload,
> extends Omit<ProcessCommandParams<EventType, Payload>, "payload" | "jobId"> {
  /** Same-command payloads to coalesce, in dispatch (occurredAt) order. */
  payloads: Payload[];
  /** Each payload's stable queue job id, by position. */
  jobIds?: readonly string[];
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
 * Resolve the single tenant for the batch, enforcing that a coalesced batch
 * comes from ONE tenant-scoped group. A mismatch is an upstream routing bug —
 * fail loudly rather than write cross-tenant events under one insert.
 */
function resolveBatchTenantId(args: {
  validatedPayloads: readonly TenantScopedPayload[];
  commandType: CommandType;
}): TenantId {
  const { validatedPayloads, commandType } = args;
  const tenantId = createTenantId(String(validatedPayloads[0]!.tenantId));
  for (const validated of validatedPayloads) {
    if (createTenantId(String(validated.tenantId)) !== tenantId) {
      throw new ValidationError({
        reason: `Coalesced batch for command type "${commandType}" mixes tenants. All payloads in one group share a tenant.`,
        field: "tenantId",
        context: { commandType },
      });
    }
  }
  return tenantId;
}

/**
 * Handle and collect events for every validated payload in dispatch order.
 * `progress.attempted` counts validated payloads so the
 * caller's metrics (and its catch block) see the count even on a mid-loop throw.
 */
async function handleBatchCommands<
  EventType extends Event,
  Payload extends TenantScopedPayload,
>(args: {
  params: ProcessCommandBatchParams<EventType, Payload>;
  validatedPayloads: Payload[];
  progress: BatchProgress;
}): Promise<{ handledCommands: Command<Payload>[]; allEvents: EventType[] }> {
  const { params, validatedPayloads, progress } = args;
  const { getAggregateId, handler, commandType, aggregateType } = params;

  const handledCommands: Command<Payload>[] = [];
  const allEvents: EventType[] = [];
  for (const [position, validated] of validatedPayloads.entries()) {
    const payloadTenantId = createTenantId(String(validated.tenantId));
    const aggregateId = getAggregateId(validated);

    // Mirrors the single path's silent return: no events, no metrics — but
    // the rest of the batch still runs.
    if (
      await isComponentKilled({
        killSwitch: params.killSwitch,
        aggregateType,
        componentType: "command",
        componentName: params.commandName,
        tenantId: payloadTenantId,
        customKey: params.killSwitchOptions?.customKey,
        logger: params.logger,
      })
    ) {
      continue;
    }

    progress.attempted++;
    const command = createCommand({
      tenantId: payloadTenantId,
      aggregateId,
      type: commandType,
      data: validated,
    });
    const handled = await handler.handle(command);
    validateHandlerEvents(handled, commandType);
    const events = keyEventsByJob({ events: handled, jobId: params.jobIds?.[position] });
    // Only a command that contributed events is "handled" for cleanup,
    // mirroring the single path's `if (events.length > 0)` gate — running
    // cleanup off some OTHER payload's successful append would release a
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
 * best-effort post-store cleanup (ADR-022). A cleanup failure is logged and
 * swallowed — it must never roll back durable events.
 */
async function persistBatch<EventType extends Event, Payload extends TenantScopedPayload>(args: {
  params: ProcessCommandBatchParams<EventType, Payload>;
  tenantId: TenantId;
  allEvents: EventType[];
  handledCommands: Command<Payload>[];
}): Promise<void> {
  const { params, tenantId, allEvents, handledCommands } = args;
  const { handler, storeEventsFn, commandType, logger: log } = params;

  if (allEvents.length === 0) {
    return;
  }

  await storeUnlessTenantGone({ storeEventsFn, events: allEvents, tenantId, commandType, log });
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
 * Emit one counter increment and one duration sample per attempted command.
 * The whole-batch time is amortised across attempts so each sample carries a
 * per-command time rather than N-commands of it.
 */
function emitBatchMetrics<EventType extends Event, Payload extends TenantScopedPayload>(args: {
  params: ProcessCommandBatchParams<EventType, Payload>;
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
 * Batched sibling of processCommand: collapses N single-row appends into one
 * multi-row insert. Handlers must be stateless per item (no read-your-writes).
 */
export async function processCommandBatch<
  EventType extends Event,
  Payload extends TenantScopedPayload,
>(params: ProcessCommandBatchParams<EventType, Payload>): Promise<void> {
  if (params.payloads.length === 0) {
    return;
  }

  const validatedPayloads = params.payloads;
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
  /** Operator stop for this command, resolved per tenant at dispatch time. */
  killSwitch?: KillSwitchOptions;
  getAggregateId?: (payload: Payload) => string;
  getGroupKey?: (payload: Payload) => string;
  delay?: number;
  deduplication?: DeduplicationStrategy<Payload>;
  concurrency?: number;
  spanAttributes?: (payload: Payload) => Record<string, string | number | boolean>;
}
