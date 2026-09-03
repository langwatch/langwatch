/**
 * The identity ledger writer: the app's implementation of
 * `@langwatch/identity-server`'s IdentityLedger port, in the shape the
 * grants ledger already has (`app-layer/authz/ledger.ts`, ADR-110):
 *
 *   1. the command staged onto the per-user GroupQueue — the queued run is
 *      what APPENDS, re-running the same guard the calling path ran;
 *   2. a bounded read-your-writes wait, watching the projection's cursor
 *      reach the events the guard decided.
 *
 * The staged command is the SOLE appender, and that is the correction ADR-110
 * already made for grants. Appending here as well and staging the command
 * afterwards writes every fact twice: the queued run re-executes the handler
 * against heads the fold has not advanced yet, so it restates and appends a
 * second row. The projection converges either way — the store dedupes
 * `commandId:index` on read — but the log would carry two rows per ceremony,
 * and "a re-run costs no row" would not be true.
 *
 * `commit` runs both legs back to back, which is what every ceremony wants.
 * The born-finalized entrance (ADR-116 §3) is the one caller that has to
 * interleave: its Postgres row writes belong between handing the facts to the
 * engine and observing the fold, so it reaches `stage` and `awaitFold`
 * directly rather than reimplementing either. Staging FIRST is what keeps its
 * loud failure honest — an engine that cannot take the command fails the
 * sign-up before any row exists on either branch.
 *
 * The wait is an OBSERVATION, not inline processing. A fold that cannot run
 * makes it time out; the command is still queued, the caller still succeeds,
 * and the rows appear when the queue drains. That is why the guards read the
 * heads and state only what the heads do not carry (#7429): a pass that runs
 * against a lagging projection restates, and restating is the repair.
 *
 * Identity used to fold on the calling path here, to keep ceremonies working
 * through a Redis outage (the D02 deliverable). That requirement was dropped
 * — the complexity was not worth it at ceremony volume — so identity no
 * longer diverges from ADR-110's queue-only rule and this writer has no
 * second apply path to keep in agreement with the fold.
 *
 * Like the grants ledger, the pipeline handle is resolved lazily off the
 * App: better-auth constructs its adapter at module load, before any App
 * exists, and a bare script that never composes one must still be able to
 * import the runtime.
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
} from "@langwatch/identity";
import type { IdentityLedger } from "@langwatch/identity-server";
import { createLogger } from "@langwatch/observability";
import type { Event } from "~/server/event-sourcing/domain/types";
import { identityEventsFor } from "~/server/event-sourcing/pipelines/identity/envelope";
import type { IdentityFoldState } from "~/server/event-sourcing/pipelines/identity/projections/identityState.foldProjection";
import { IDENTITY_PIPELINE_NAME } from "~/server/event-sourcing/pipelines/identity/schemas/constants";
import type { IdentityEvent } from "~/server/event-sourcing/pipelines/identity/schemas/events";
import type { StateProjectionStore } from "~/server/event-sourcing/projections/stateProjection.types";
import type { EventStore } from "~/server/event-sourcing/stores/eventStore.types";
import {
  identityCommitDurationSeconds,
  identityProjectionConvergenceTimeoutsTotal,
} from "./metrics";
import {
  awaitedAppPipelineSender,
  resolveAppEventStore,
  StagedLedgerWriter,
  type StagedSender,
} from "./staged-ledger-writer";

const logger = createLogger("langwatch:identity:ledger");

/** The read-your-writes window, the grants ledger's convergence shape. */
export const IDENTITY_CONVERGENCE_TIMEOUT_MS = 2_000;
export const IDENTITY_CONVERGENCE_POLL_MS = 25;

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
 * The App's event store, waited for.
 *
 * Exported because the identity log has a second reader now (D05's operator
 * lookup, which folds proposals and renders history out of the same events),
 * and two copies of "wait for the App handle, then ask for the store" is two
 * places for the deadline to drift.
 */
export async function resolveIdentityEventStore(): Promise<
  EventStore<IdentityEvent>
> {
  return resolveEventStore<IdentityEvent>();
}

/**
 * The same store, typed for whichever identity-area stream is being read.
 *
 * There is ONE store; the type parameter is the caller saying which stream's
 * events it is about to narrow. The scim_sync log (ADR-126) reads through
 * here rather than casting the identity resolver, which would have made the
 * types say "identity events" about a stream that holds none.
 */
export async function resolveEventStore<TEvent extends Event>(): Promise<
  EventStore<TEvent>
> {
  return resolveAppEventStore<TEvent>({
    unavailableMessage:
      "identity ledger cannot append: the event-sourcing stack is unavailable",
  });
}

const resolveStagedSender = awaitedAppPipelineSender({
  pipelineName: IDENTITY_PIPELINE_NAME,
});

export interface IdentityLedgerWriterDeps {
  projectionStore: StateProjectionStore<IdentityFoldState>;
  /** Production resolves the pipeline handle lazily; tests hand one in. */
  stagedSender?: (name: string) => Promise<StagedSender | null>;
  /** The read-your-writes window; production uses the constants above. */
  convergence?: { timeoutMs: number; pollMs: number };
}

export class IdentityLedgerWriter
  extends StagedLedgerWriter<IdentityCommand, IdentityEvent, IdentityFoldState>
  implements IdentityLedger
{
  constructor(deps: IdentityLedgerWriterDeps) {
    const convergence = deps.convergence ?? {
      timeoutMs: IDENTITY_CONVERGENCE_TIMEOUT_MS,
      pollMs: IDENTITY_CONVERGENCE_POLL_MS,
    };
    super({
      stagedSender: deps.stagedSender ?? resolveStagedSender,
      // No append of its own: the staged command is the sole appender
      // (ADR-110), which is what keeps one ceremony to one event row.
      waitedAppend: null,
      readYourWrites: {
        projectionStore: deps.projectionStore,
        timeoutMs: convergence.timeoutMs,
        pollMs: convergence.pollMs,
        onTimeout: ({ aggregateId, eventCount }) => {
          identityProjectionConvergenceTimeoutsTotal.inc();
          logger.warn(
            { userId: aggregateId, commandCount: eventCount },
            "identity projection did not land a ceremony's events within the read-your-writes window; the command is queued and the fold will converge",
          );
        },
        onUnreadableProjection: ({ aggregateId, error }) => {
          logger.warn(
            { userId: aggregateId, error },
            "could not read the identity projection while waiting for convergence; continuing",
          );
        },
      },
    });
  }

  protected senderNameFor(command: IdentityCommand): string {
    return SENDER_NAME_BY_COMMAND[command.type];
  }

  protected onMissingSender({ senderName }: { senderName: string }): never {
    // A wiring defect, not a transient: the pipeline exposed no sender for
    // a command type it declares. Loud, because nothing downstream folds.
    throw new Error(
      `identity ledger cannot stage: the identity pipeline exposes no "${senderName}" sender`,
    );
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
      await this.stageAndAwait({ command, events });
      return events;
    } finally {
      done();
    }
  }

  /**
   * Both legs: staging — the queued run appends and folds, so this is how the
   * log and the projection ever learn, and a failure here is a real failure
   * because nothing else would state these events — followed by the bounded
   * read-your-writes wait. The backfill's own pass depends on that wait: it
   * verifies an identifier the same pass just attached.
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
   * Leg one on its own: the command handed to the queue, which is where the
   * append happens.
   *
   * Public because ADR-116 §3's born-finalized entrance has to put its
   * Postgres row writes BETWEEN the two legs — the engine must have taken the
   * facts before any row exists, and the `Identifier` row must be there when
   * sign-up returns. The entrance sequences the same two legs these methods
   * implement, rather than a second copy of them.
   */
  override async stage({
    command,
  }: {
    command: IdentityCommand;
  }): Promise<void> {
    await super.stage({ command });
  }

  /**
   * Leg two: wait for the projection's cursor to reach the last event the
   * guard decided.
   *
   * Public for the same reason `stage` is, and keyed by `userId` because the
   * entrance names the newborn rather than an anonymous aggregate.
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
    await this.awaitConvergence({ aggregateId: userId, tenantId, events });
  }
}
