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
import { tryGetApp } from "~/server/app-layer/app";
import {
  type AggregateType,
  createTenantId,
  type EventStore,
  type StateProjectionStore,
} from "@langwatch/eventing";
import {
  JOIN_REQUEST_AGGREGATE_TYPE,
  JOIN_REQUEST_PIPELINE_NAME,
  type JoinRequestEvent,
  type JoinRequestFoldState,
  joinRequestEventsFor,
} from "@langwatch/identity-eventing";

const logger = createLogger("langwatch:identity:join-request-ledger");

/** How long a command waits for the App handle before the append gives up. */
const JOIN_REQUEST_APP_HANDLE_WAIT_MS = 5_000;

/** The read-your-writes window, the identity ledger's convergence shape. */
export const JOIN_REQUEST_CONVERGENCE_TIMEOUT_MS = 2_000;
export const JOIN_REQUEST_CONVERGENCE_POLL_MS = 25;

export type JoinRequestStagedSender = {
  send(data: unknown): Promise<unknown>;
};

const SENDER_NAME_BY_COMMAND: Record<JoinRequestCommandType, string> = {
  [REQUEST_JOIN_COMMAND_TYPE]: "requestJoin",
  [APPROVE_JOIN_COMMAND_TYPE]: "approveJoin",
  [REJECT_JOIN_COMMAND_TYPE]: "rejectJoin",
  [WITHDRAW_JOIN_COMMAND_TYPE]: "withdrawJoin",
  [EXPIRE_JOIN_COMMAND_TYPE]: "expireJoin",
};

async function resolveEventStore(): Promise<EventStore<JoinRequestEvent>> {
  const deadline = Date.now() + JOIN_REQUEST_APP_HANDLE_WAIT_MS;
  let app = tryGetApp();
  while (!app && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 50));
    app = tryGetApp();
  }
  const eventStore = app?.eventSourcing?.isEnabled
    ? app.eventSourcing.getEventStore<JoinRequestEvent>()
    : undefined;
  if (!eventStore) {
    // A plain Error on purpose (error doctrine): the caller cannot act on an
    // unavailable event stack, and the command degrades to a retryable
    // failure with a trace id.
    throw new Error(
      "join request ledger cannot append: the event-sourcing stack is unavailable",
    );
  }
  return eventStore;
}

function resolveStagedSender(name: string): JoinRequestStagedSender | null {
  const app = tryGetApp();
  if (!app?.eventSourcing?.isEnabled) return null;
  try {
    const pipeline = app.eventSourcing.getPipeline(
      JOIN_REQUEST_PIPELINE_NAME as never,
    ) as unknown as { commands: Record<string, JoinRequestStagedSender> };
    return pipeline.commands[name] ?? null;
  } catch {
    return null;
  }
}

export interface JoinRequestLedgerWriterDeps {
  projectionStore: StateProjectionStore<JoinRequestFoldState>;
  /** Production resolves the App's event store lazily; tests hand one in. */
  eventStore?: () => Promise<EventStore<JoinRequestEvent>>;
  stagedSender?: (name: string) => JoinRequestStagedSender | null;
  convergence?: { timeoutMs: number; pollMs: number };
}

export class JoinRequestLedgerWriter implements JoinRequestLedger {
  private readonly projectionStore: StateProjectionStore<JoinRequestFoldState>;
  private readonly eventStore: () => Promise<EventStore<JoinRequestEvent>>;
  private readonly stagedSender: (
    name: string,
  ) => JoinRequestStagedSender | null;
  private readonly convergence: { timeoutMs: number; pollMs: number };

  constructor(deps: JoinRequestLedgerWriterDeps) {
    this.projectionStore = deps.projectionStore;
    this.eventStore = deps.eventStore ?? resolveEventStore;
    this.stagedSender = deps.stagedSender ?? resolveStagedSender;
    this.convergence = deps.convergence ?? {
      timeoutMs: JOIN_REQUEST_CONVERGENCE_TIMEOUT_MS,
      pollMs: JOIN_REQUEST_CONVERGENCE_POLL_MS,
    };
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

    const eventStore = await this.eventStore();
    await eventStore.storeEvents(
      events,
      { tenantId: createTenantId(tenantId) },
      JOIN_REQUEST_AGGREGATE_TYPE as AggregateType,
    );

    await this.stage({ command });
    await this.awaitFold({ joinRequestId, tenantId, events });
    return events as unknown as JoinRequestFact[];
  }

  private async stage({
    command,
  }: {
    command: JoinRequestCommand;
  }): Promise<void> {
    const senderName = SENDER_NAME_BY_COMMAND[command.type];
    const sender = this.stagedSender(senderName);
    if (!sender) {
      // A wiring defect, not a transient: the pipeline exposed no sender for
      // a command type it declares. Loud, because nothing downstream folds.
      throw new Error(
        `join request ledger cannot stage: the pipeline exposes no "${senderName}" sender`,
      );
    }
    await sender.send(command.data);
  }

  private async awaitFold({
    joinRequestId,
    tenantId,
    events,
  }: {
    joinRequestId: string;
    tenantId: string;
    events: JoinRequestEvent[];
  }): Promise<void> {
    const last = events[events.length - 1];
    if (!last) return;
    const context = {
      aggregateId: joinRequestId,
      tenantId: createTenantId(tenantId),
    };
    // Wall-clock, not injectable business time: a frozen test clock would
    // otherwise make this loop unable to time out.
    const deadline = Date.now() + this.convergence.timeoutMs;
    for (;;) {
      if (await this.foldReached({ joinRequestId, context, last })) return;
      if (Date.now() >= deadline) {
        logger.warn(
          { joinRequestId, commandCount: events.length },
          "join request projection did not land a command's events within the read-your-writes window; the append is durable and the fold will converge",
        );
        return;
      }
      await new Promise((resolve) =>
        setTimeout(resolve, this.convergence.pollMs),
      );
    }
  }

  private async foldReached({
    joinRequestId,
    context,
    last,
  }: {
    joinRequestId: string;
    context: {
      aggregateId: string;
      tenantId: ReturnType<typeof createTenantId>;
    };
    last: JoinRequestEvent;
  }): Promise<boolean> {
    try {
      const stored = await this.projectionStore.tryLoad(joinRequestId, context);
      const cursor = stored?.cursor;
      if (!cursor) return false;
      return (
        cursor.acceptedAt > last.createdAt ||
        (cursor.acceptedAt === last.createdAt && cursor.eventId >= last.id)
      );
    } catch (error) {
      // An unreadable projection is not a failed command: the facts are
      // durable. Stop waiting and let the caller proceed.
      logger.warn(
        { joinRequestId, error },
        "could not read the join request projection while waiting for convergence; continuing",
      );
      return true;
    }
  }
}
