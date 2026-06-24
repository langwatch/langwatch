import { DEFAULT_TRACE_DEBOUNCE_MS } from "~/automations/cadences";
import { createLogger } from "~/utils/logger/server";
import { captureException, toError } from "~/utils/posthogErrorCapture";
import type { Event } from "../domain/types";
import type {
  ReactorContext,
  ReactorDefinition,
} from "../reactors/reactor.types";
import type { OutboxReactorDefinition } from "./outboxReactor.types";
import { isSettle, type SettleStagePayload } from "./payload";
import type { OutboxRuntime } from "./setup";

const logger = createLogger("langwatch:event-sourcing:outbox-reactor-adapter");

/**
 * Bridges the `OutboxReactorDefinition` API (decide → enqueue requests)
 * with the GroupQueue-routed outbox runtime that this codebase actually
 * ships (ADR-030 r3). For every event the wrapped reactor's `decide()`
 * is invoked; each returned `OutboxEnqueueRequest` is forwarded to
 * `outbox.enqueueSettle(...)`.
 *
 * The request's `dedupKey` / `groupKey` / `maxAttempts` are descriptive
 * of the spec's row-leased architecture (see
 * `dev/docs/adr/030-transactional-outbox-for-stake-sensitive-dispatch.md`);
 * the GroupQueue route derives its identity from the payload itself via
 * `settleDedupId` + `settleGroupKey`, so those fields are not threaded
 * through here. `enqueueOptions.ttlMs` IS threaded — it carries the
 * per-trigger trace-readiness debounce (ADR-026).
 *
 * When no outbox runtime is present (web process, or a worker that opted
 * out of outbox via `LANGWATCH_SKIP_OUTBOX`), the adapter degrades to a
 * no-op handle so the pipeline registration is harmless on those roles.
 */
export function adaptOutboxReactor<E extends Event, FoldState>(
  definition: OutboxReactorDefinition<E, FoldState>,
  outbox: OutboxRuntime | undefined,
): ReactorDefinition<E, FoldState> {
  if (!outbox) {
    logger.warn(
      { reactorName: definition.name },
      "Outbox reactor registered without an outbox runtime; events reaching this reactor on this process will be dropped (expected on web, a misconfiguration on a worker)",
    );
    return {
      name: definition.name,
      options: definition.options,
      async handle(event: E) {
        // No outbox runtime wired for this process role. The handle only
        // fires on processes that actually consume events, so reaching
        // here means a NOTIFY-class trigger is being dropped — surface it
        // loudly instead of failing silent.
        logger.warn(
          {
            reactorName: definition.name,
            eventId: event.id,
            eventType: event.type,
            tenantId: event.tenantId,
          },
          "Outbox reactor received an event but no outbox runtime is wired; dropping the dispatch (check LANGWATCH_SKIP_OUTBOX / worker outbox wiring)",
        );
      },
    };
  }

  return {
    name: definition.name,
    options: definition.options,
    async handle(event: E, context: ReactorContext<FoldState>) {
      // Replay short-circuit (ADR-030 / `specs/event-sourcing/reactor-outbox-dispatch.feature`).
      // When the runtime is replaying historical events, the audit row
      // for this match may have aged out of retention, so the live
      // dispatch path would re-fire customer-visible side effects.
      // `decide()` itself is cheap, but the settle enqueue + audit
      // INSERT + downstream cadence are not — skip the whole branch.
      if (context.isReplay) return;
      const requests = await definition.decide(event, context);
      if (requests.length === 0) return;

      for (const request of requests) {
        // `OutboxPayload` is `Prisma.InputJsonValue` (recursive JSON);
        // narrow it back into the structural object shape `isSettle`
        // expects so the discriminator check works.
        const payload = request.payload as Record<string, unknown>;
        if (!isSettlePayload(payload)) {
          // The current architecture only knows how to enqueue settle
          // payloads. A reactor that emits any other shape is a config
          // bug — surface it loudly so it doesn't silently drop a real
          // notification.
          const error = new Error(
            `OutboxReactor "${definition.name}" emitted a non-settle payload (stage="${
              (payload as { stage?: unknown }).stage ?? "<missing>"
            }"); the GroupQueue-routed adapter only forwards settle payloads to enqueueSettle.`,
          );
          logger.error(
            {
              reactorName: definition.name,
              dedupKey: request.dedupKey,
            },
            error.message,
          );
          captureException(error, {
            extra: {
              reactorName: definition.name,
              dedupKey: request.dedupKey,
            },
          });
          continue;
        }

        try {
          await outbox.enqueueSettle(payload, {
            ttlMs: request.enqueueOptions?.ttlMs ?? DEFAULT_TRACE_DEBOUNCE_MS,
          });
        } catch (error) {
          // Mirror the existing inline enqueue-failure behavior: log +
          // capture, continue with the next request. A bad enqueue
          // shouldn't poison the rest of the batch.
          logger.error(
            {
              reactorName: definition.name,
              dedupKey: request.dedupKey,
              error: error instanceof Error ? error.message : String(error),
            },
            "OutboxReactor enqueueSettle failed",
          );
          captureException(toError(error), {
            extra: {
              reactorName: definition.name,
              dedupKey: request.dedupKey,
            },
          });
        }
      }
    },
  };
}

function isSettlePayload(
  payload: Record<string, unknown>,
): payload is SettleStagePayload {
  return isSettle(payload);
}
