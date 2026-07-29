/**
 * Mounted on `simulation-processing/pipeline.ts` as an event subscriber.
 *
 * The push is filtered client-side on `scenarioSetId`
 * (`useSimulationUpdateListener`), and a subscriber has no fold to read that id
 * back from — so it has to ride the event. `batchRunId` and `scenarioSetId` are
 * therefore carried by `message_snapshot`, `text_message_end`, `finished` and
 * `deleted` as well as `queued` and `started` (`runPlacementFields` in
 * `../schemas/shared`, spread by both the event and the command declarations so
 * the two cannot drift). They are OPTIONAL and additive rather than a version
 * bump: the versions are asserted with `z.literal`, so bumping one would stop
 * every already-committed event of that type from parsing. An event written
 * before that shipped simply pushes without the ids, exactly as every event did
 * beforehand.
 *
 * Every inbound SDK event holds both ids on `baseScenarioEventSchema`, and
 * `dispatchSimulationEvent` forwards them onto all four commands, so a run's
 * SDK-reported lifecycle pushes with its placement attached.
 *
 * The two server-side emitters of `finished` pass them too, and it matters more
 * there than anywhere else. `scenario-failure-handler.ts` is the single terminal
 * path for every reaped run — stalled, cancel nobody honoured, executor fault
 * after dispatch, and both boot sweeps — and the cancellation router writes the
 * terminal event for a queued run no worker will pick up. Both once dropped the
 * ids they were holding, so those pushes carried the run id alone: a panel
 * filtered to a set could not match them, and with the client's stall re-check
 * and its SSE-disabled fallback poll both gone, an open suite panel displayed a
 * dead run as IN_PROGRESS until the user navigated away. A run whose placement
 * is genuinely unknown still pushes with the ids absent, exactly as before.
 */

import { createLogger } from "@langwatch/observability";

import type { BroadcastService } from "~/server/app-layer/broadcast/broadcast.service";

import type {
  EventSubscriberContext,
  EventSubscriberDefinition,
} from "../../../subscribers/eventSubscriber.types";
import { SIMULATION_RUN_EVENT_TYPES } from "../schemas/constants";
import type { SimulationProcessingEvent } from "../schemas/events";

const logger = createLogger(
  "langwatch:simulation-processing:snapshot-update-broadcast",
);

/**
 * Debounce window for the run-drawer nudge. Deliberately short: a user
 * watching a live run is waiting on exactly this, and the frontend collapses
 * whatever still gets through.
 */
export const SNAPSHOT_UPDATE_BROADCAST_DEDUP_TTL_MS = 1_000;

interface SnapshotUpdateBroadcastSubscriberDeps {
  broadcast: BroadcastService;
}

/**
 * The one event this must stay quiet for.
 *
 * A `text_message_start` opens a streaming message, and the API route pushes
 * the streaming frames itself. A generic "refetch the run" nudge on the same
 * instant makes the client replace accumulated streaming content with a fold
 * row that has not caught up yet, so the message visibly empties out and
 * refills.
 *
 * TOTAL by construction — a field comparison on an event the caller already
 * holds, with no decode, no lookup and nothing fallible. The enqueue seam has
 * no retry, so a predicate that throws loses this subscriber's job for this
 * event permanently (ADR-069).
 */
function suppressesBroadcast(event: SimulationProcessingEvent): boolean {
  return event.type === SIMULATION_RUN_EVENT_TYPES.TEXT_MESSAGE_START;
}

/**
 * The two ids the client filters on beyond the run id, read off the event.
 *
 * TOTAL by construction, for the same reason `suppressesBroadcast` is: a
 * typeof-guarded field pick, no decode and no narrowing on the event union.
 * An event that does not carry an id yields `undefined` and the key is simply
 * absent from the pushed payload.
 */
function readBroadcastIds(event: SimulationProcessingEvent): {
  batchRunId?: string;
  scenarioSetId?: string;
} {
  const data: unknown = event.data;
  if (typeof data !== "object" || data === null) return {};

  const { batchRunId, scenarioSetId } = data as {
    batchRunId?: unknown;
    scenarioSetId?: unknown;
  };

  return {
    batchRunId: typeof batchRunId === "string" ? batchRunId : undefined,
    scenarioSetId:
      typeof scenarioSetId === "string" ? scenarioSetId : undefined,
  };
}

/**
 * Pushes a "this run moved, refetch it" nudge to whichever SSE clients are
 * connected right now (ADR-075 Class A).
 *
 * **At-most-once, by design — do not put this behind an outbox.** There is
 * deliberately no durable trace and no redelivery: the push only means
 * anything to a browser connected at the moment it is sent, and redelivering
 * one to a tab that closed an hour ago is a leak rather than a fix. A lost
 * nudge is corrected by the client's next refetch and by the run's next event,
 * which is why a broadcast failure is logged and swallowed here — throwing
 * would hand the job back to the queue for exactly the durability this must
 * not have. (The cancellation broadcast on this pipeline reads the opposite
 * way and does rethrow; losing one of those leaves a child process running.)
 *
 * **Event-only.** The run id is the aggregate id, and the batch and set ids
 * ride the event. Nothing is read back from `simulationRunState` — the fold
 * this used to bind to is built from the very stream this consumes.
 *
 * `Status` is gone from the payload. `SimulationBroadcastPayload` declared it
 * and no client ever read it: `matchesFilter` matches on the three ids, and
 * the run's state comes from the refetch the nudge triggers, not from the
 * nudge.
 *
 * Ordering note: as a reactor this ran after the `simulationRunState` fold
 * committed; as a subscriber it is dispatched from the routing seam,
 * independent of the fold. The nudge therefore says "something happened on
 * this run", not "the row for this run is already stored" — which is what it
 * has always meant to the client, since the client refetches rather than
 * trusting the push.
 *
 * `hasRedis` is deliberately absent from the deps. Nothing ever read it, and
 * making it live would be a regression rather than a fix: without Redis
 * `BroadcastService` falls back to its in-process emitter, which is precisely
 * the single-process topology (app hosting the workers) where the push still
 * reaches a subscribed client.
 */
export function createSnapshotUpdateBroadcastSubscriber(
  deps: SnapshotUpdateBroadcastSubscriberDeps,
): EventSubscriberDefinition<SimulationProcessingEvent> {
  return {
    name: "snapshotUpdateBroadcast",
    // Empty means all event types, on purpose: every event this pipeline
    // routes moves something a client is looking at, and a new event type must
    // broadcast by default rather than be silently omitted from a list.
    eventTypes: [],
    options: {
      enqueue: { filter: (event) => !suppressesBroadcast(event) },
      deduplication: {
        makeId: (event) =>
          `sim-update:${event.tenantId}:${String(event.aggregateId)}`,
        ttlMs: SNAPSHOT_UPDATE_BROADCAST_DEDUP_TTL_MS,
      },
    },

    async handle(
      event: SimulationProcessingEvent,
      context: EventSubscriberContext,
    ): Promise<void> {
      const { tenantId, aggregateId: scenarioRunId } = context;

      // Re-checked rather than trusted: the enqueue filter rejects before a job
      // is staged, but a job staged by a build without it can still be in the
      // queue during a rolling deploy.
      if (suppressesBroadcast(event)) {
        logger.debug(
          { tenantId, scenarioRunId },
          "Skipped run broadcast for text_message_start — the API route pushes the streaming frames",
        );
        return;
      }

      const { batchRunId, scenarioSetId } = readBroadcastIds(event);

      try {
        const payload = JSON.stringify({
          event: "simulation_updated",
          scenarioRunId,
          batchRunId,
          scenarioSetId,
        });

        await deps.broadcast.broadcastToTenant(
          tenantId,
          payload,
          "simulation_updated",
        );

        logger.debug(
          { tenantId, scenarioRunId, batchRunId },
          "Broadcasted simulation update",
        );
      } catch (error) {
        logger.warn(
          {
            tenantId,
            scenarioRunId,
            error: error instanceof Error ? error.message : String(error),
          },
          "Failed to broadcast simulation update — non-fatal, at-most-once by design",
        );
      }
    },
  };
}
