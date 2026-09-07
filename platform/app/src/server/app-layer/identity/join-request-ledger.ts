/**
 * The join-request ledger writer: the app's implementation of
 * `@langwatch/identity-server`'s JoinRequestLedger, in the shape the
 * identity, connection and grants ledgers already have (ADR-110, ADR-101):
 *
 *   1. the durable ClickHouse append, WAITED — the fact lands before the
 *      caller returns;
 *   2. the command staged onto the per-request GroupQueue, awaited — the
 *      fold is the queue's, and this module never applies a projection
 *      itself;
 *   3. a bounded read-your-writes wait, watching the projection's cursor
 *      reach the events just appended.
 *
 * The wait is an OBSERVATION, not inline processing. A fold that cannot run
 * makes it time out; the facts are still durable, the caller still succeeds,
 * and the row appears when the queue drains. This leg matters more here than
 * elsewhere: an admin who clicks Approve and is returned to a panel still
 * showing the request believes the click did nothing.
 *
 * Like the other ledgers, the pipeline handle is resolved lazily off the App:
 * a bare script that never composes one must still be able to import the
 * runtime.
 */
import {
  APPROVE_JOIN_COMMAND_TYPE,
  EXPIRE_JOIN_COMMAND_TYPE,
  type JoinRequestCommand,
  type JoinRequestCommandType,
  type JoinRequestFact,
  type JoinRequestFactInput,
  REJECT_JOIN_COMMAND_TYPE,
  REQUEST_JOIN_COMMAND_TYPE,
  WITHDRAW_JOIN_COMMAND_TYPE,
} from "@langwatch/identity";
import type { JoinRequestLedger } from "@langwatch/identity-server";
import { createLogger } from "@langwatch/observability";
import type { AggregateType } from "~/server/event-sourcing/domain/aggregateType";
import { joinRequestEventsFor } from "~/server/event-sourcing/pipelines/join-requests/envelope";
import type { JoinRequestFoldState } from "~/server/event-sourcing/pipelines/join-requests/projections/joinRequestState.foldProjection";
import {
  JOIN_REQUEST_AGGREGATE_TYPE,
  JOIN_REQUEST_PIPELINE_NAME,
} from "~/server/event-sourcing/pipelines/join-requests/schemas/constants";
import type { JoinRequestEvent } from "~/server/event-sourcing/pipelines/join-requests/schemas/events";
import type { StateProjectionStore } from "~/server/event-sourcing/projections/stateProjection.types";
import type { EventStore } from "~/server/event-sourcing/stores/eventStore.types";
import {
  appPipelineSender,
  resolveAppEventStore,
  StagedLedgerWriter,
  type StagedSender,
} from "./staged-ledger-writer";

const logger = createLogger("langwatch:identity:join-request-ledger");

/** The read-your-writes window, the identity ledger's convergence shape. */
export const JOIN_REQUEST_CONVERGENCE_TIMEOUT_MS = 2_000;
export const JOIN_REQUEST_CONVERGENCE_POLL_MS = 25;

const SENDER_NAME_BY_COMMAND: Record<JoinRequestCommandType, string> = {
  [REQUEST_JOIN_COMMAND_TYPE]: "requestJoin",
  [APPROVE_JOIN_COMMAND_TYPE]: "approveJoin",
  [REJECT_JOIN_COMMAND_TYPE]: "rejectJoin",
  [WITHDRAW_JOIN_COMMAND_TYPE]: "withdrawJoin",
  [EXPIRE_JOIN_COMMAND_TYPE]: "expireJoin",
};

async function resolveEventStore(): Promise<EventStore<JoinRequestEvent>> {
  return resolveAppEventStore<JoinRequestEvent>({
    unavailableMessage:
      "join request ledger cannot append: the event-sourcing stack is unavailable",
  });
}

const resolveStagedSender = appPipelineSender({
  pipelineName: JOIN_REQUEST_PIPELINE_NAME,
});

export interface JoinRequestLedgerWriterDeps {
  projectionStore: StateProjectionStore<JoinRequestFoldState>;
  /** Production resolves the App's event store lazily; tests hand one in. */
  eventStore?: () => Promise<EventStore<JoinRequestEvent>>;
  stagedSender?: (name: string) => StagedSender | null;
  convergence?: { timeoutMs: number; pollMs: number };
}

export class JoinRequestLedgerWriter
  extends StagedLedgerWriter<
    JoinRequestCommand,
    JoinRequestEvent,
    JoinRequestFoldState
  >
  implements JoinRequestLedger
{
  constructor(deps: JoinRequestLedgerWriterDeps) {
    const convergence = deps.convergence ?? {
      timeoutMs: JOIN_REQUEST_CONVERGENCE_TIMEOUT_MS,
      pollMs: JOIN_REQUEST_CONVERGENCE_POLL_MS,
    };
    super({
      stagedSender: deps.stagedSender ?? resolveStagedSender,
      waitedAppend: {
        eventStore: deps.eventStore ?? resolveEventStore,
        aggregateType: JOIN_REQUEST_AGGREGATE_TYPE as AggregateType,
      },
      readYourWrites: {
        projectionStore: deps.projectionStore,
        timeoutMs: convergence.timeoutMs,
        pollMs: convergence.pollMs,
        onTimeout: ({ aggregateId, eventCount }) => {
          logger.warn(
            { joinRequestId: aggregateId, commandCount: eventCount },
            "join request projection did not land a command's events within the read-your-writes window; the append is durable and the fold will converge",
          );
        },
        onUnreadableProjection: ({ aggregateId, error }) => {
          logger.warn(
            { joinRequestId: aggregateId, error },
            "could not read the join request projection while waiting for convergence; continuing",
          );
        },
      },
    });
  }

  protected senderNameFor(command: JoinRequestCommand): string {
    return SENDER_NAME_BY_COMMAND[command.type];
  }

  protected onMissingSender({ senderName }: { senderName: string }): never {
    // A wiring defect, not a transient: the pipeline exposed no sender for
    // a command type it declares. Loud, because nothing downstream folds.
    throw new Error(
      `join request ledger cannot stage: the pipeline exposes no "${senderName}" sender`,
    );
  }

  async commit({
    command,
    facts,
  }: {
    command: JoinRequestCommand;
    facts: JoinRequestFactInput[];
  }): Promise<JoinRequestFact[]> {
    const events = joinRequestEventsFor({ command, facts });
    if (events.length === 0) return [];
    const { joinRequestId, tenantId } = command.data;

    await this.append({ events, tenantId });
    await this.stage({ command });
    await this.awaitConvergence({
      aggregateId: joinRequestId,
      tenantId,
      events,
    });
    return events as unknown as JoinRequestFact[];
  }
}
