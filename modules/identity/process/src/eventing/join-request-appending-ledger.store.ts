import { createTenantId, type OwnEventStore, type StateProjectionStore } from "@langwatch/eventing";
/**
 * The join-request ledger writer, in the shape the identity, connection and 1. the durable
 * ClickHouse append, WAITED — the fact lands before the caller returns;
 * grants ledgers already have (ADR-110, ADR-101):
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
  JOIN_REQUEST_PIPELINE_NAME,
} from "@langwatch/identity-contract";
import { createLogger } from "@langwatch/observability";
import { nowInstant } from "@langwatch/time";

import type { JoinRequestLedger } from "../rules/join-request-ledger.rules.ts";
import type { IdentityEventing } from "./identity-command-senders.store.ts";
import { joinRequestEventsFor } from "./join-request-events.intent.ts";
import type { JoinRequestEvent, JoinRequestFoldState } from "./join-request-state.projection.ts";

const logger = createLogger("langwatch:identity:join-request-ledger");

/** The read-your-writes window, the identity ledger's convergence shape. */
const JOIN_REQUEST_CONVERGENCE_TIMEOUT_MS = 2_000;
const JOIN_REQUEST_CONVERGENCE_POLL_MS = 25;

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

/** The one write this ledger takes off the join_request pipeline's own store. */
export type JoinRequestEventAppends = Pick<OwnEventStore, "append">;

type AppendingJoinRequestLedgerOptions = {
  projectionStore: StateProjectionStore<JoinRequestFoldState>;
  /** The join_request pipeline's own store. */
  eventStore: JoinRequestEventAppends;
  /** The connected pipeline's command sender, by name, or null while absent. */
  tryResolveStagedSender: (name: string) => Promise<JoinRequestStagedSender | null>;
  convergence?: { timeoutMs: number; pollMs: number };
};

export class AppendingJoinRequestLedgerStore implements JoinRequestLedger {
  /** Over the pipeline's own store and the senders the process connected. */
  static forPipeline(options: {
    projectionStore: StateProjectionStore<JoinRequestFoldState>;
    eventStore: JoinRequestEventAppends;
    commands: IdentityEventing;
  }): AppendingJoinRequestLedgerStore {
    const { projectionStore, eventStore, commands } = options;
    return AppendingJoinRequestLedgerStore.create({
      projectionStore,
      eventStore,
      tryResolveStagedSender: async (command) => {
        const resolved = await commands.resolvePipelineCommand({
          pipeline: JOIN_REQUEST_PIPELINE_NAME,
          command,
        });
        return resolved.kind === "registered" ? resolved.sender : null;
      },
    });
  }

  static create(options: AppendingJoinRequestLedgerOptions): AppendingJoinRequestLedgerStore {
    return new AppendingJoinRequestLedgerStore(options);
  }

  private readonly convergence: { timeoutMs: number; pollMs: number };

  private constructor(private readonly options: AppendingJoinRequestLedgerOptions) {
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

    await this.options.eventStore.append({ tenantId, events });

    await this.stage({ command });
    await this.awaitFold({ joinRequestId, tenantId, events });
    return events;
  }

  private async stage({ command }: { command: JoinRequestCommand }): Promise<void> {
    const senderName = SENDER_NAME_BY_COMMAND[command.type];
    const sender = await this.options.tryResolveStagedSender(senderName);
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
    const deadline = nowInstant().epochMilliseconds + this.convergence.timeoutMs;
    let isReached = await this.foldReached({ joinRequestId, context, last });
    while (!isReached && nowInstant().epochMilliseconds < deadline) {
      await new Promise((resolve) => setTimeout(resolve, this.convergence.pollMs));
      isReached = await this.foldReached({ joinRequestId, context, last });
    }
    if (isReached) return;

    logger.warn(
      { joinRequestId, commandCount: events.length },
      "join request projection did not land a command's events within the read-your-writes window; the append is durable and the fold will converge",
    );
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
      const stored = await this.options.projectionStore.get(joinRequestId, context);
      if (stored.kind === "empty") return false;
      const { cursor } = stored.projection;
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
