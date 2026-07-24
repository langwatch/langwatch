import { performance } from "node:perf_hooks";
import type { createLogger } from "@langwatch/observability";
import {
  incrementEsCommandTotal,
  observeEsCommandDuration,
} from "~/server/metrics";
import { mapZodIssuesToLogContext } from "~/utils/zod";
import type { FeatureFlagServiceInterface } from "../../../featureFlag/types";
import type { Command, CommandHandler } from "../../commands/command";
import { createCommand } from "../../commands/command";
import type { CommandSchema } from "../../commands/commandSchema";
import type { AggregateType } from "../../domain/aggregateType";
import type { CommandType } from "../../domain/commandType";
import type { TenantId } from "../../domain/tenantId";
import { createTenantId } from "../../domain/tenantId";
import type { Event } from "../../domain/types";
import { EventSchema } from "../../domain/types";
import type { KillSwitchOptions } from "../../pipeline/staticBuilder.types";
import type { DeduplicationStrategy } from "../../queues";
import type { EventStoreReadContext } from "../../stores/eventStore.types";
import { EventUtils } from "../../utils/event.utils";
import { isComponentDisabled } from "../../utils/killSwitch";
import { ValidationError } from "../errorHandling";

/**
 * Constraint interface for payloads that support command processing.
 * All command payloads must include a tenantId for tenant isolation
 * and occurredAt for global FIFO ordering.
 */
interface BaseCommandPayload {
  tenantId: TenantId | string;
  occurredAt: number;
}

/**
 * Parameters for the extracted processCommand function.
 */
export interface ProcessCommandParams<EventType extends Event> {
  payload: Record<string, unknown>;
  commandType: CommandType;
  commandSchema: CommandSchema<any, CommandType>;
  handler: CommandHandler<Command<any>, EventType>;
  getAggregateId: (payload: any) => string;
  storeEventsFn: (
    events: EventType[],
    context: EventStoreReadContext<EventType>,
  ) => Promise<void>;
  aggregateType: AggregateType;
  commandName: string;
  pipelineName: string;
  featureFlagService?: FeatureFlagServiceInterface;
  killSwitchOptions?: KillSwitchOptions;
  logger?: ReturnType<typeof createLogger>;
}

/**
 * Validates that a command handler returned a defined array of well-formed
 * events, throwing a {@link ValidationError} otherwise.
 *
 * Extracted so {@link processCommand} and {@link processCommandBatch} reject
 * identical malformed handler output rather than each carrying its own copy.
 */
function validateHandlerEvents(
  events: unknown,
  commandType: CommandType,
): void {
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
              .map((issue: any) => `${issue.path.join(".")}: ${issue.message}`)
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
            parseResult.success === false
              ? mapZodIssuesToLogContext(parseResult.error.issues)
              : void 0,
        },
      );
    }
  }
}

/**
 * Processes a command: validates the payload, checks kill switch, invokes the handler,
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
    featureFlagService,
    killSwitchOptions,
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
        zodIssues: mapZodIssuesToLogContext(validation.error.issues),
      },
    );
  }

  const validated = validation.data;
  const tenantId = createTenantId(String(validated.tenantId));
  const aggregateId = getAggregateId(validated);

  const disabled = await isComponentDisabled({
    featureFlagService,
    aggregateType,
    componentType: "command",
    componentName: commandName,
    tenantId,
    customKey: killSwitchOptions?.customKey,
    logger: log,
  });
  if (disabled) {
    return;
  }

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
export interface ProcessCommandBatchParams<EventType extends Event>
  extends Omit<ProcessCommandParams<EventType>, "payload"> {
  /** Same-command payloads to coalesce, in dispatch (occurredAt) order. */
  payloads: Record<string, unknown>[];
}

/**
 * Batched sibling of {@link processCommand} (ADR-066 pillar 2).
 *
 * The GroupQueue drains a hot aggregate's queued same-command jobs and hands
 * them here as one ordered batch. Each payload is validated, kill-switch-checked,
 * and handled in dispatch order, then every resulting event is persisted in ONE
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
 *  - a kill-switched payload contributes no events and the batch continues;
 *  - a handler error or malformed event fails the batch;
 *  - an empty event set skips the store call.
 */
export async function processCommandBatch<EventType extends Event>(
  params: ProcessCommandBatchParams<EventType>,
): Promise<void> {
  const {
    payloads,
    commandType,
    commandSchema,
    handler,
    getAggregateId,
    storeEventsFn,
    aggregateType,
    commandName,
    pipelineName,
    featureFlagService,
    killSwitchOptions,
    logger: log,
  } = params;

  if (payloads.length === 0) {
    return;
  }

  // Phase 1 — schema-validate every payload up front. A failure throws (like the
  // single path), failing the whole batch; downstream idempotency keys make the
  // batch's retry safe.
  const validatedPayloads = payloads.map((payload) => {
    const validation = commandSchema.validate(payload);
    if (!validation.success) {
      throw new ValidationError(
        `Invalid payload for command type "${commandType}". Validation failed.`,
        "payload",
        undefined,
        {
          commandType,
          zodIssues: mapZodIssuesToLogContext(validation.error.issues),
        },
      );
    }
    return validation.data;
  });

  // Defensive invariant: a coalesced batch comes from ONE group, which is
  // tenant-scoped, so every payload must share a tenant. A mismatch is a routing
  // bug upstream — fail loudly rather than write cross-tenant events under one
  // tenant's insert.
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

  const batchStartTime = performance.now();
  // Commands whose handler ran and validated — cleanup runs per one of these.
  const handledCommands: Command<any>[] = [];
  const allEvents: EventType[] = [];
  // Non-kill-switched payloads attempted this batch. Both metrics count this,
  // mirroring the single path where a kill-switched return emits nothing.
  let attempted = 0;
  try {
    for (const validated of validatedPayloads) {
      const payloadTenantId = createTenantId(String(validated.tenantId));
      const aggregateId = getAggregateId(validated);

      const disabled = await isComponentDisabled({
        featureFlagService,
        aggregateType,
        componentType: "command",
        componentName: commandName,
        tenantId: payloadTenantId,
        customKey: killSwitchOptions?.customKey,
        logger: log,
      });
      if (disabled) {
        // Mirror the single path's silent return: no events, no metrics — but
        // the rest of the batch still runs.
        continue;
      }

      attempted++;
      const command = createCommand(
        payloadTenantId,
        aggregateId,
        commandType,
        validated,
      );
      const events = await handler.handle(command);
      validateHandlerEvents(events, commandType);
      handledCommands.push(command);
      for (const event of events) {
        allEvents.push(event);
      }
    }

    if (allEvents.length > 0) {
      // ONE multi-row append for the whole batch (ADR-066 pillar 2).
      await storeEventsFn(allEvents, { tenantId });
      // ADR-022 post-store cleanup, per handled command, best-effort — a cleanup
      // failure must never roll back durable events.
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

    const durationMs = performance.now() - batchStartTime;
    // Keep counter and histogram 1:1 like the single path: one duration sample
    // per attempted command. The whole-batch time is amortised across them so
    // the histogram's sample count matches the counter and each sample carries a
    // per-command time rather than N-commands of it.
    const perCommandMs = attempted > 0 ? durationMs / attempted : 0;
    for (let i = 0; i < attempted; i++) {
      incrementEsCommandTotal(pipelineName, commandType, "completed");
      observeEsCommandDuration(pipelineName, commandType, perCommandMs);
    }
  } catch (error) {
    const durationMs = performance.now() - batchStartTime;
    const perCommandMs = attempted > 0 ? durationMs / attempted : 0;
    for (let i = 0; i < attempted; i++) {
      incrementEsCommandTotal(pipelineName, commandType, "failed");
      observeEsCommandDuration(pipelineName, commandType, perCommandMs);
    }
    throw error;
  }
}

/**
 * Options for configuring a command handler.
 */
export interface CommandHandlerOptions<Payload> {
  getAggregateId?: (payload: Payload) => string;
  getGroupKey?: (payload: Payload) => string;
  /**
   * Serialize this command with every other command that enables the option
   * for the same tenant and aggregate. This keeps command handling, event
   * append, and projection staging atomic with respect to the next command
   * for that aggregate while allowing other aggregates to run concurrently.
   */
  serializeByAggregate?: boolean;
  /**
   * Coalesce this producer's appends (ADR-066 pillar 2). When one aggregate can
   * mint events faster than they drain — a hot trigger recording every match —
   * set the max number of same-command jobs (including the dispatched one) to
   * fold into a single multi-row insert. Leave unset (or ≤ 1) for a low-fan-in
   * producer where one aggregate appends at most one event per human action:
   * those append immediately, with the per-job path unchanged.
   */
  coalesceMaxBatch?: number;
  /**
   * Optional byte cap for a coalesced batch (ADR-066 pillar 2). The drain stops
   * before a job that would push the batch past this size, keeping one insert
   * inside the downstream flush budget; a job too large to fit becomes its own
   * dispatch. Unset falls back to the GroupQueue default. Only consulted when
   * `coalesceMaxBatch` enables coalescing.
   */
  coalesceMaxBytes?: number;
  delay?: number;
  deduplication?: DeduplicationStrategy<Payload>;
  concurrency?: number;
  spanAttributes?: (
    payload: Payload,
  ) => Record<string, string | number | boolean>;
  killSwitch?: KillSwitchOptions;
}
