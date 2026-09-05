/**
 * The identity ledger writer: stages the command, then waits for the
 * projection to reach it — the grants ledger's shape (ADR-110). The staged
 * command is the SOLE appender; ADR-116 §3's caller stages first, then awaits.
 */
import {
  ATTACH_IDENTIFIER_COMMAND_TYPE,
  DETACH_IDENTIFIER_COMMAND_TYPE,
  ERASE_USER_COMMAND_TYPE,
  type IdentityCommand,
  type IdentityCommandType,
  type IdentityFact,
  type IdentityFactInput,
  MARK_PRIMARY_COMMAND_TYPE,
  PROPOSE_LINK_COMMAND_TYPE,
  VERIFY_IDENTIFIER_COMMAND_TYPE,
} from "@langwatch/identity-contract";
import type { IdentityLedger } from "../identity-ledger";
import { createLogger } from "@langwatch/observability";
import { IdentityEventingPort } from "../ports/identity-eventing.port";
import { createTenantId, type StateProjectionStore } from "@langwatch/eventing";
import { IDENTITY_PIPELINE_NAME } from "@langwatch/identity-contract";
import type { IdentityEvent } from "../projections/identity-state.projection";
import type { IdentityFoldState } from "../projections/identity-state.projection";
import { IdentityStateFoldProjection } from "../projections/identity-state.projection";
import {
  identityCommitDurationSeconds,
  identityProjectionConvergenceTimeoutsTotal,
} from "../identity-ledger.metrics";

const logger = createLogger("langwatch:identity:ledger");

/** The read-your-writes window, the grants ledger's convergence shape. */
export const IDENTITY_CONVERGENCE_TIMEOUT_MS = 2_000;
export const IDENTITY_CONVERGENCE_POLL_MS = 25;

export type IdentityStagedSender = {
  send(data: unknown): Promise<unknown>;
};

const SENDER_NAME_BY_COMMAND: Record<IdentityCommandType, string> = {
  [ATTACH_IDENTIFIER_COMMAND_TYPE]: "attachIdentifier",
  [VERIFY_IDENTIFIER_COMMAND_TYPE]: "verifyIdentifier",
  [MARK_PRIMARY_COMMAND_TYPE]: "markPrimary",
  [DETACH_IDENTIFIER_COMMAND_TYPE]: "detachIdentifier",
  [ERASE_USER_COMMAND_TYPE]: "eraseUser",
  [PROPOSE_LINK_COMMAND_TYPE]: "proposeLink",
};

export interface IdentityLedgerWriterDeps {
  projectionStore: StateProjectionStore<IdentityFoldState>;
  /**
   * The event stack this ledger stages through. Required, and asked per command rather than held:
   * the pipeline handle is resolved when a ceremony actually commits, which is what lets a ceremony
   * composed before the process finished wiring its eventing still append.
   */
  eventing: IdentityEventingPort;
  /** A test hands the sender in directly rather than composing a port for it. */
  stagedSender?: (name: string) => Promise<IdentityStagedSender | null>;
  /** The read-your-writes window; production uses the constants above. */
  convergence?: { timeoutMs: number; pollMs: number };
}

export class IdentityLedgerWriterAdapter implements IdentityLedger {
  private readonly projectionStore: StateProjectionStore<IdentityFoldState>;
  private readonly stagedSender: (name: string) => Promise<IdentityStagedSender | null>;
  private readonly convergence: { timeoutMs: number; pollMs: number };

  static create(deps: IdentityLedgerWriterDeps): IdentityLedgerWriterAdapter {
    return new IdentityLedgerWriterAdapter(deps);
  }

  constructor(deps: IdentityLedgerWriterDeps) {
    this.projectionStore = deps.projectionStore;
    this.stagedSender =
      deps.stagedSender ??
      ((command) =>
        deps.eventing.tryPipelineCommand({ pipeline: IDENTITY_PIPELINE_NAME, command }));
    this.convergence = deps.convergence ?? {
      timeoutMs: IDENTITY_CONVERGENCE_TIMEOUT_MS,
      pollMs: IDENTITY_CONVERGENCE_POLL_MS,
    };
  }

  async commit({
    command,
    facts,
  }: {
    command: IdentityCommand;
    facts: IdentityFactInput[];
  }): Promise<IdentityFact[]> {
    const events = IdentityStateFoldProjection.eventsFor({ command, facts });
    if (events.length === 0) return [];
    const done = identityCommitDurationSeconds.startTimer();
    try {
      await this.stageAndAwait({ command, events });
      return events;
    } finally {
      done();
    }
  }

  /**
   * Both legs: staging — the queued run appends and folds, so this is how the log and the
   * projection ever learn, and a failure here is a real failure because nothing else would state
   * these events — followed by the bounded read-your-writes wait.
   */
  async stageAndAwait({
    command,
    events,
  }: {
    command: IdentityCommand;
    events: IdentityEvent[];
  }): Promise<void> {
    const { userId, tenantId } = command.data;
    await this.stage({ command });
    await this.awaitFold({ userId, tenantId, events });
  }

  /**
   * Leg one on its own: the command handed to the queue, which is where the append happens.
   * Public because ADR-116 §3's born-finalized entrance has to put its
   */
  async stage({ command }: { command: IdentityCommand }): Promise<void> {
    const senderName = SENDER_NAME_BY_COMMAND[command.type];
    const sender = await this.stagedSender(senderName);
    if (!sender) {
      // A wiring defect, not a transient: the pipeline exposed no sender for
      // a command type it declares. Loud, because nothing downstream folds.
      throw new Error(
        `identity ledger cannot stage: the identity pipeline exposes no "${senderName}" sender`,
      );
    }
    await sender.send(command.data);
  }

  /**
   * Leg two: wait for the projection's cursor to reach the last event the guard decided.
   */
  async awaitFold({
    userId,
    tenantId,
    events,
  }: {
    userId: string;
    tenantId: string;
    events: IdentityEvent[];
  }): Promise<void> {
    const last = events[events.length - 1];
    if (!last) return;
    const context = { aggregateId: userId, tenantId: createTenantId(tenantId) };
    // Wall-clock, not injectable business time: a frozen test clock would
    // otherwise make this loop unable to time out.
    const deadline = Date.now() + this.convergence.timeoutMs;
    for (;;) {
      if (await this.foldReached({ userId, context, last })) return;
      if (Date.now() >= deadline) {
        identityProjectionConvergenceTimeoutsTotal.inc();
        logger.warn(
          { userId, commandCount: events.length },
          "identity projection did not land a ceremony's events within the read-your-writes window; the command is queued and the fold will converge",
        );
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, this.convergence.pollMs));
    }
  }

  private async foldReached({
    userId,
    context,
    last,
  }: {
    userId: string;
    context: {
      aggregateId: string;
      tenantId: ReturnType<typeof createTenantId>;
    };
    last: IdentityEvent;
  }): Promise<boolean> {
    try {
      const stored = await this.projectionStore.tryLoad(userId, context);
      const cursor = stored?.cursor;
      if (!cursor) return false;
      return (
        cursor.acceptedAt > last.createdAt ||
        (cursor.acceptedAt === last.createdAt && cursor.eventId >= last.id)
      );
    } catch (error) {
      // An unreadable projection is not a failed ceremony: the facts are
      // durable. Stop waiting and let the caller proceed.
      logger.warn(
        { userId, error },
        "could not read the identity projection while waiting for convergence; continuing",
      );
      return true;
    }
  }
}
