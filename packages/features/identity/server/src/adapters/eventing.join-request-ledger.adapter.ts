/**
 * The join-request ledger writer, in the shape the identity, connection and
 * grants ledgers already have (ADR-110, ADR-101):
 *
 *   1. the durable ClickHouse append, WAITED — the fact lands before the
 *      caller returns;
 *   2. the command staged onto the per-request GroupQueue, awaited — the fold
 *      is the queue's, and this module never applies a projection itself;
 *   3. a bounded read-your-writes wait, watching the projection's cursor reach
 *      the events just appended.
 *
 * The wait is an OBSERVATION, not inline processing. A fold that cannot run
 * makes it time out; the facts are still durable, the caller still succeeds,
 * and the row appears when the queue drains. This leg matters more here than
 * elsewhere: an admin who clicks Approve and is returned to a panel still
 * showing the request believes the click did nothing.
 *
 * The event store and the staged senders are resolved LAZILY, from the runtime
 * this pipeline is registered on. That is not deferral for its own sake: the
 * expiry wake dispatches `expireJoin` back into the same pipeline, so a writer
 * that resolved a sender at construction would have to be built after the
 * pipeline that needs it.
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
} from "@langwatch/identity-contract";
import type { JoinRequestLedger } from "../join-request-ledger";
import { createLogger } from "@langwatch/observability";
import {
  type AggregateType,
  createTenantId,
  type EventStore,
  type StateProjectionStore,
} from "@langwatch/eventing";
import { JOIN_REQUEST_AGGREGATE_TYPE } from "@langwatch/identity-contract";
import type { JoinRequestEvent } from "./join-request-pipeline-definition.adapter";
import { joinRequestEventsFor } from "./join-request-pipeline-definition.adapter";
import type { JoinRequestFoldState } from "../projections/join-request-state.projection";

const logger = createLogger("langwatch:identity:join-request-ledger");

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

export type EventingJoinRequestLedgerOptions = {
  projectionStore: StateProjectionStore<JoinRequestFoldState>;
  /** The durable event store, resolved when the first command appends. */
  eventStore: () => Promise<EventStore<JoinRequestEvent>>;
  /** The registered pipeline's command sender, by name, or null while absent. */
  tryResolveStagedSender: (name: string) => JoinRequestStagedSender | null;
  convergence?: { timeoutMs: number; pollMs: number };
};

export class EventingJoinRequestLedgerAdapter implements JoinRequestLedger {
  static create(options: EventingJoinRequestLedgerOptions): EventingJoinRequestLedgerAdapter {
    return new EventingJoinRequestLedgerAdapter(options);
  }

  private readonly convergence: { timeoutMs: number; pollMs: number };

  private constructor(private readonly options: EventingJoinRequestLedgerOptions) {
    this.convergence = options.convergence ?? {
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

    const eventStore = await this.options.eventStore();
    await eventStore.storeEvents(
      events,
      { tenantId: createTenantId(tenantId) },
      JOIN_REQUEST_AGGREGATE_TYPE as AggregateType,
    );

    await this.stage({ command });
    await this.awaitFold({ joinRequestId, tenantId, events });
    return events as unknown as JoinRequestFact[];
  }

  private async stage({ command }: { command: JoinRequestCommand }): Promise<void> {
    const senderName = SENDER_NAME_BY_COMMAND[command.type];
    const sender = this.options.tryResolveStagedSender(senderName);
    if (!sender) {
      // A wiring defect, not a transient: the pipeline exposed no sender for a
      // command type it declares. Loud, because nothing downstream folds.
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
    const context = { aggregateId: joinRequestId, tenantId: createTenantId(tenantId) };
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
      await new Promise((resolve) => setTimeout(resolve, this.convergence.pollMs));
    }
  }

  private async foldReached({
    joinRequestId,
    context,
    last,
  }: {
    joinRequestId: string;
    context: { aggregateId: string; tenantId: ReturnType<typeof createTenantId> };
    last: JoinRequestEvent;
  }): Promise<boolean> {
    try {
      const stored = await this.options.projectionStore.tryLoad(joinRequestId, context);
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
