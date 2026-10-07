import { createTenantId, type StateProjectionStore } from "@langwatch/eventing";
/**
 * The identity ledger writer: stages the command, then waits for the
 * projection to reach it — the grants ledger's shape (ADR-110). The staged
 * command is the SOLE appender; ADR-116 §3's caller stages first, then awaits.
 */
import {
  ATTACH_IDENTIFIER_COMMAND_TYPE,
  CONFIRM_LINK_COMMAND_TYPE,
  DETACH_IDENTIFIER_COMMAND_TYPE,
  ERASE_USER_COMMAND_TYPE,
  type IdentityCommand,
  type IdentityCommandType,
  type IdentityFact,
  type IdentityFactInput,
  MARK_PRIMARY_COMMAND_TYPE,
  PROPOSE_LINK_COMMAND_TYPE,
  REJECT_LINK_COMMAND_TYPE,
  VERIFY_IDENTIFIER_COMMAND_TYPE,
  IDENTITY_PIPELINE_NAME,
  type IdentifierFact,
  reduceIdentity,
} from "@langwatch/identity-contract";
import { createLogger } from "@langwatch/observability";
import { nowInstant } from "@langwatch/time";
import { Counter, Histogram, register } from "prom-client";

import type { IdentityHeadsRepository } from "../repositories/identity-heads.repository.ts";
import type { IdentityLedger } from "../rules/identity-ledger.rules.ts";
import type { IdentityEventing } from "./identity-command-senders.store.ts";
import { identityEventsFor } from "./identity-events.intent.ts";
import type { IdentityEvent, IdentityFoldState } from "./identity-state.projection.ts";

const logger = createLogger("langwatch:identity:ledger");

// Remove existing metrics if they exist (for hot reload)
const metricNames = [
  "identity_projection_convergence_timeouts_total",
  "identity_commit_duration_seconds",
] as const;

for (const name of metricNames) {
  register.removeSingleMetric(name);
}

/**
 * A ceremony's read-your-writes wait expired before the fold landed its events in the `Identifier`
 * projection (the grants ledger's `awaitProjection` shape).
 */
export const identityProjectionConvergenceTimeoutsTotal = new Counter({
  name: "identity_projection_convergence_timeouts_total",
  help: "Identity ceremonies that returned before the fold landed their events; the append is durable and the projection converges later.",
});

/** End-to-end cost of one identity commit: append, stage, and the wait. */
const identityCommitDurationSeconds = new Histogram({
  name: "identity_commit_duration_seconds",
  help: "Duration of an identity ledger commit: durable append, queue staging, and the read-your-writes wait.",
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
});

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
  [CONFIRM_LINK_COMMAND_TYPE]: "confirmLink",
  [REJECT_LINK_COMMAND_TYPE]: "rejectLink",
};

/**
 * The projection's one write that is not the fold's: a newborn's heads, rows only, before the
 * first fold lands. The cursor is never part of it (ADR-135 decision 2, restored by Q63).
 */
export interface ProvisionalHeadsWriter {
  writeProvisionalHeads(args: { facts: IdentifierFact[] }): Promise<void>;
}

export interface IdentityLedgerWriterDeps {
  projectionStore: StateProjectionStore<IdentityFoldState> & ProvisionalHeadsWriter;
  /** Whether the user has folded, and what their heads hold: the provisional write's two reads. */
  heads: Pick<IdentityHeadsRepository, "hasFolded" | "findHeads">;
  /**
   * The event stack this ledger stages through. Required, and asked per command rather than held:
   * the pipeline handle is resolved when a ceremony actually commits, which is what lets a ceremony
   * composed before the process finished wiring its eventing still append.
   */
  eventing: IdentityEventing;
  /** A test hands the sender in directly rather than composing a port for it. */
  stagedSender?: (name: string) => Promise<IdentityStagedSender | null>;
  /** The read-your-writes window; production uses the constants above. */
  convergence?: { timeoutMs: number; pollMs: number };
}

export class IdentityLedgerStore implements IdentityLedger {
  private readonly projectionStore: IdentityLedgerWriterDeps["projectionStore"];
  private readonly heads: IdentityLedgerWriterDeps["heads"];
  private readonly stagedSender: (name: string) => Promise<IdentityStagedSender | null>;
  private readonly convergence: { timeoutMs: number; pollMs: number };

  static create(deps: IdentityLedgerWriterDeps): IdentityLedgerStore {
    return new IdentityLedgerStore(deps);
  }

  constructor(deps: IdentityLedgerWriterDeps) {
    this.projectionStore = deps.projectionStore;
    this.heads = deps.heads;
    this.stagedSender =
      deps.stagedSender ??
      ((command) =>
        deps.eventing
          .resolvePipelineCommand({ pipeline: IDENTITY_PIPELINE_NAME, command })
          .then((resolved) => (resolved.kind === "registered" ? resolved.sender : null)));
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
    const events = identityEventsFor({ command, facts });
    if (events.length === 0) return [];
    const done = identityCommitDurationSeconds.startTimer();
    try {
      await this.writeProvisionalHeads({ command, events });
      await this.stageAndAwait({ command, events });
      return events;
    } finally {
      done();
    }
  }

  /**
   * A newborn's heads, rows only, before the command is staged: the front door routes the address
   * while the fold is queued; the fold overwrites them whole and sets the cursor. Never fails the
   * ceremony; a failed stage after it leaves a row the next pass restates (main's ledger.ts).
   */
  private async writeProvisionalHeads({
    command,
    events,
  }: {
    command: IdentityCommand;
    events: IdentityEvent[];
  }): Promise<void> {
    if (command.type !== ATTACH_IDENTIFIER_COMMAND_TYPE) return;
    const { userId } = command.data;
    try {
      if (await this.heads.hasFolded({ userId })) return;
      const current = await this.heads.findHeads({ userId });
      const heads = events.reduce(
        (folded, event) => reduceIdentity({ heads: folded, fact: event }),
        current,
      );
      const facts = events.flatMap((event) => {
        const identifierId = "identifierId" in event.data ? event.data.identifierId : null;
        const head = identifierId ? heads.identifiers[identifierId] : undefined;
        return head ? [head] : [];
      });
      if (facts.length === 0) return;
      await this.projectionStore.writeProvisionalHeads({ facts });
    } catch (error) {
      logger.warn(
        { userId, error },
        "could not write a newborn's provisional identifier heads; the fold writes them when the queue drains",
      );
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
   */
  private async stage({ command }: { command: IdentityCommand }): Promise<void> {
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
  private async awaitFold({
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
    const deadline = nowInstant().epochMilliseconds + this.convergence.timeoutMs;
    let isReached = await this.foldReached({ userId, context, last });
    while (!isReached && nowInstant().epochMilliseconds < deadline) {
      await new Promise((resolve) => setTimeout(resolve, this.convergence.pollMs));
      isReached = await this.foldReached({ userId, context, last });
    }
    if (isReached) return;

    identityProjectionConvergenceTimeoutsTotal.inc();
    logger.warn(
      { userId, commandCount: events.length },
      "identity projection did not land a ceremony's events within the read-your-writes window; the command is queued and the fold will converge",
    );
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
      const stored = await this.projectionStore.get(userId, context);
      if (stored.kind === "empty") return false;
      const { cursor } = stored.projection;
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
