/**
 * connection and grants ledgers already have (ADR-110, ADR-116):
 * durable log here and stage afterwards, which is ADR-101's original order —
 * and ADR-110 corrected it for exactly this reason: the queued run re-executes
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
import type { JoinRequestLedger } from "../rules/join-request-ledger.rules";
import { createLogger } from "@langwatch/observability";
import { IdentityEventingPort } from "../ports/identity-eventing.port";
import { createTenantId, type StateProjectionStore } from "@langwatch/eventing";
import { JOIN_REQUEST_PIPELINE_NAME } from "@langwatch/identity-contract";
import type { JoinRequestEvent } from "../projections/join-request-state.projection";
import type { JoinRequestFoldState } from "../projections/join-request-state.projection";
import { JoinRequestStateFoldProjection } from "../projections/join-request-state.projection";

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

export interface JoinRequestLedgerWriterDeps {
  projectionStore: StateProjectionStore<JoinRequestFoldState>;
  /**
   * The event stack this ledger stages through. Required, and asked per command rather than held:
   * the pipeline handle is resolved when a ceremony actually commits, which is what lets a ledger
   * composed before the process finished wiring its eventing still stage.
   */
  eventing: IdentityEventingPort;
  /** A test hands the sender in directly rather than composing a port for it. */
  stagedSender?: (name: string) => Promise<JoinRequestStagedSender | null>;
  convergence?: { timeoutMs: number; pollMs: number };
}

export class JoinRequestLedgerWriterAdapter implements JoinRequestLedger {
  private readonly projectionStore: StateProjectionStore<JoinRequestFoldState>;
  private readonly stagedSender: (name: string) => Promise<JoinRequestStagedSender | null>;
  private readonly convergence: { timeoutMs: number; pollMs: number };

  static create(deps: JoinRequestLedgerWriterDeps): JoinRequestLedgerWriterAdapter {
    return new JoinRequestLedgerWriterAdapter(deps);
  }

  constructor(deps: JoinRequestLedgerWriterDeps) {
    this.projectionStore = deps.projectionStore;
    this.stagedSender =
      deps.stagedSender ??
      ((command) =>
        deps.eventing.tryPipelineCommand({
          pipeline: JOIN_REQUEST_PIPELINE_NAME,
          command,
        }));
    this.convergence = deps.convergence ?? {
      timeoutMs: JOIN_REQUEST_CONVERGENCE_TIMEOUT_MS,
      pollMs: JOIN_REQUEST_CONVERGENCE_POLL_MS,
    };
  }

  /**
   * The events the command states, returned to the caller after the queue has taken it.
   */
  async commit({
    command,
    facts,
  }: {
    command: JoinRequestCommand;
    facts: JoinRequestFactInput[];
  }): Promise<JoinRequestFact[]> {
    const events = JoinRequestStateFoldProjection.eventsFor({ command, facts });
    if (events.length === 0) return [];
    const { joinRequestId, tenantId } = command.data;

    await this.stage({ command });
    await this.awaitFold({ joinRequestId, tenantId, events });
    return events as unknown as JoinRequestFact[];
  }

  /**
   * Leg one: the command handed to the queue, which is where the append happens. Loud on a missing
   * sender, and that is the whole of its error handling.
   */
  private async stage({ command }: { command: JoinRequestCommand }): Promise<void> {
    const senderName = SENDER_NAME_BY_COMMAND[command.type];
    const sender = await this.stagedSender(senderName);
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
          "join request projection did not land a command's events within the read-your-writes window; the command is queued and the fold will converge",
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
      // An unreadable projection is not a failed command: the command is
      // queued. Stop waiting and let the caller proceed.
      logger.warn(
        { joinRequestId, error },
        "could not read the join request projection while waiting for convergence; continuing",
      );
      return true;
    }
  }
}
