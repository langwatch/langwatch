/**
 * The identity ledger writer: the app's implementation of
 * `@langwatch/identity-server`'s IdentityLedger port, in the shape the
 * grants ledger already has (`app-layer/authz/ledger.ts`, ADR-110):
 *
 *   1. the durable ClickHouse append, WAITED — the fact lands before the
 *      caller returns;
 *   2. the command staged onto the per-user GroupQueue, awaited — the fold
 *      is the queue's, and this package never applies a projection itself;
 *   3. a bounded read-your-writes wait, watching the projection's cursor
 *      reach the events just appended.
 *
 * `commit` runs all three back to back, which is what every ceremony wants.
 * The born-finalized entrance (ADR-116 §3) is the one caller that has to
 * interleave: its Postgres row writes belong between the append and the
 * fold, because the fold declines to project a user that does not exist yet.
 * It reaches `append` and `stageAndAwait` directly rather than reimplementing
 * either.
 *
 * The wait is an OBSERVATION, not inline processing. A fold that cannot run
 * makes it time out; the facts are still durable, the caller still succeeds,
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
  DETACH_IDENTIFIER_COMMAND_TYPE,
  ERASE_USER_COMMAND_TYPE,
  type IdentityCommand,
  type IdentityCommandType,
  type IdentityFact,
  type IdentityFactInput,
  MARK_PRIMARY_COMMAND_TYPE,
  VERIFY_IDENTIFIER_COMMAND_TYPE,
} from "@langwatch/identity";
import type { IdentityLedger } from "@langwatch/identity-server";
import { createLogger } from "@langwatch/observability";
import { tryGetApp } from "~/server/app-layer/app";
import { createTenantId } from "~/server/event-sourcing";
import type { AggregateType } from "~/server/event-sourcing/domain/aggregateType";
import { identityEventsFor } from "~/server/event-sourcing/pipelines/identity/envelope";
import type { IdentityFoldState } from "~/server/event-sourcing/pipelines/identity/projections/identityState.foldProjection";
import {
  IDENTITY_PIPELINE_NAME,
  USER_IDENTITY_AGGREGATE_TYPE,
} from "~/server/event-sourcing/pipelines/identity/schemas/constants";
import type { IdentityEvent } from "~/server/event-sourcing/pipelines/identity/schemas/events";
import type { StateProjectionStore } from "~/server/event-sourcing/projections/stateProjection.types";
import type { EventStore } from "~/server/event-sourcing/stores/eventStore.types";
import {
  identityCommitDurationSeconds,
  identityProjectionConvergenceTimeoutsTotal,
} from "./metrics";

const logger = createLogger("langwatch:identity:ledger");

/** How long a ceremony waits for the App handle before the append gives up. */
const IDENTITY_APP_HANDLE_WAIT_MS = 5_000;

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
};

async function resolveEventStore(): Promise<EventStore<IdentityEvent>> {
  const deadline = Date.now() + IDENTITY_APP_HANDLE_WAIT_MS;
  let app = tryGetApp();
  while (!app && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 50));
    app = tryGetApp();
  }
  const eventStore = app?.eventSourcing?.isEnabled
    ? app.eventSourcing.getEventStore<IdentityEvent>()
    : undefined;
  if (!eventStore) {
    // A plain Error on purpose (error doctrine): the caller cannot act on an
    // unavailable event stack, and the ceremony degrades to a retryable
    // failure with a trace id.
    throw new Error(
      "identity ledger cannot append: the event-sourcing stack is unavailable",
    );
  }
  return eventStore;
}

function resolveStagedSender(name: string): IdentityStagedSender | null {
  const app = tryGetApp();
  if (!app?.eventSourcing?.isEnabled) return null;
  try {
    const pipeline = app.eventSourcing.getPipeline(
      IDENTITY_PIPELINE_NAME as never,
    ) as unknown as { commands: Record<string, IdentityStagedSender> };
    return pipeline.commands[name] ?? null;
  } catch {
    return null;
  }
}

export interface IdentityLedgerWriterDeps {
  projectionStore: StateProjectionStore<IdentityFoldState>;
  /** Production resolves the App's event store lazily; tests hand one in. */
  eventStore?: () => Promise<EventStore<IdentityEvent>>;
  stagedSender?: (name: string) => IdentityStagedSender | null;
  /** The read-your-writes window; production uses the constants above. */
  convergence?: { timeoutMs: number; pollMs: number };
}

export class IdentityLedgerWriter implements IdentityLedger {
  private readonly projectionStore: StateProjectionStore<IdentityFoldState>;
  private readonly eventStore: () => Promise<EventStore<IdentityEvent>>;
  private readonly stagedSender: (name: string) => IdentityStagedSender | null;
  private readonly convergence: { timeoutMs: number; pollMs: number };

  constructor(deps: IdentityLedgerWriterDeps) {
    this.projectionStore = deps.projectionStore;
    this.eventStore = deps.eventStore ?? resolveEventStore;
    this.stagedSender = deps.stagedSender ?? resolveStagedSender;
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
      await this.append({ command, events });
      await this.stageAndAwait({ command, events });
      return events;
    } finally {
      done();
    }
  }

  /**
   * Leg one on its own: the durable append, waited — the fact lands before
   * this returns, and nothing has been projected yet.
   *
   * Public because ADR-116 §3's born-finalized entrance has to put its
   * Postgres row writes BETWEEN the append and the fold: the fold declines
   * to project a user that does not exist, so staging before the rows commit
   * would leave the newborn's `Identifier` row missing when sign-up returns.
   * The entrance sequences the same two legs this method and the next
   * implement, rather than a second copy of them.
   */
  async append({
    command,
    events,
  }: {
    command: IdentityCommand;
    events: IdentityEvent[];
  }): Promise<void> {
    const { tenantId } = command.data;
    const eventStore = await this.eventStore();
    await eventStore.storeEvents(
      events,
      { tenantId: createTenantId(tenantId) },
      USER_IDENTITY_AGGREGATE_TYPE as AggregateType,
    );
  }

  /**
   * Legs two and three: staging — the fold is the queue's, so this is how
   * the projection ever learns; a failure here is a real failure, because
   * nothing else would apply these events — followed by the bounded
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

  private async stage({
    command,
  }: {
    command: IdentityCommand;
  }): Promise<void> {
    const senderName = SENDER_NAME_BY_COMMAND[command.type];
    const sender = this.stagedSender(senderName);
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
   * Wait for the projection's cursor to reach the last event appended. The
   * same comparison the fold uses to decide an event is already applied,
   * read here instead of written — which is what makes this an observation
   * of the queue's work rather than a second writer racing it.
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
    const deadline = Date.now() + this.convergence.timeoutMs;
    for (;;) {
      if (await this.foldReached({ userId, context, last })) return;
      if (Date.now() >= deadline) {
        identityProjectionConvergenceTimeoutsTotal.inc();
        logger.warn(
          { userId, commandCount: events.length },
          "identity projection did not land a ceremony's events within the read-your-writes window; the append is durable and the fold will converge",
        );
        return;
      }
      await new Promise((resolve) =>
        setTimeout(resolve, this.convergence.pollMs),
      );
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
      const stored = await this.projectionStore.load(userId, context);
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
