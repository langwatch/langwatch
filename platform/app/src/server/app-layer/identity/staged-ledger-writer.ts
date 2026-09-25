/**
 * The machinery the five identity ledger writers share (ADR-129).
 *
 * Identity, join requests, two-step verification, SSO connections and
 * directory sync each write their facts the same way:
 *
 *   1. OPTIONALLY the durable ClickHouse append, WAITED — for the ledgers
 *      whose fact must land before the caller returns. Identity and directory
 *      sync name no append at all: there the staged command is the SOLE
 *      appender (ADR-110), and appending here as well would write every fact
 *      twice.
 *   2. the command staged onto its aggregate's GroupQueue lane, awaited — the
 *      fold is the queue's, and no ledger applies a projection itself;
 *   3. OPTIONALLY a bounded read-your-writes wait, watching the projection's
 *      cursor reach the events the guard decided.
 *
 * The wait is an OBSERVATION, not inline processing. A fold that cannot run
 * makes it time out; the caller still succeeds, and the rows appear when the
 * queue drains.
 *
 * Every ledger names all three legs when it is constructed — an append or a
 * wait it does not run is `null` in its own file, next to the comment saying
 * why. There is no way to end up without a wait by forgetting one.
 *
 * The pipeline handle is resolved lazily off the App: better-auth constructs
 * its adapter at module load, before any App exists, and a bare script that
 * never composes one must still be able to import the runtime. Which of the
 * two resolvers below a ledger names — the one that WAITS for the App handle,
 * or the one that reads it as it stands — is the ledger's own call and differs
 * between them today.
 */
import { createLogger } from "@langwatch/observability";
import { tryGetApp } from "~/server/app-layer/app";
import { createTenantId } from "~/server/event-sourcing";
import type { AggregateType } from "~/server/event-sourcing/domain/aggregateType";
import type { Event } from "~/server/event-sourcing/domain/types";
import type { StateProjectionStore } from "~/server/event-sourcing/projections/stateProjection.types";
import type { EventStore } from "~/server/event-sourcing/stores/eventStore.types";

/** One pipeline command sender, as a ledger needs it. */
export type StagedSender = {
  send(data: unknown): Promise<unknown>;
};

/**
 * How a ledger finds the sender for one command name.
 *
 * Production resolves it off the App; tests hand one in, which is the seam
 * that keeps `getApp` out of every ledger test. Answering synchronously is
 * allowed because some ledgers read the App as it stands rather than waiting
 * for it.
 */
export type StagedSenderPort = (
  name: string,
) => Promise<StagedSender | null> | StagedSender | null;

/** How long a ledger waits for the App handle before it gives up. */
const APP_HANDLE_WAIT_MS = 5_000;
const APP_HANDLE_POLL_MS = 50;

/** The App once it exists, or whatever there is when the deadline passes. */
async function awaitAppHandle(): Promise<ReturnType<typeof tryGetApp>> {
  const deadline = Date.now() + APP_HANDLE_WAIT_MS;
  let app = tryGetApp();
  while (!app && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, APP_HANDLE_POLL_MS));
    app = tryGetApp();
  }
  return app;
}

/**
 * The App's event store, waited for.
 *
 * `unavailableMessage` is the ledger's own words for a stack that never
 * arrived. It is a plain Error on purpose (error doctrine): the caller cannot
 * act on an unavailable event stack, and the write degrades to a retryable
 * failure with a trace id.
 */
export async function resolveAppEventStore<TEvent extends Event>({
  unavailableMessage,
}: {
  unavailableMessage: string;
}): Promise<EventStore<TEvent>> {
  const app = await awaitAppHandle();
  const eventStore = app?.eventSourcing?.isEnabled
    ? app.eventSourcing.getEventStore<TEvent>()
    : undefined;
  if (!eventStore) throw new Error(unavailableMessage);
  return eventStore;
}

function senderOn({
  app,
  pipelineName,
  name,
}: {
  app: ReturnType<typeof tryGetApp>;
  pipelineName: string;
  name: string;
}): StagedSender | null {
  if (!app?.eventSourcing?.isEnabled) return null;
  try {
    const pipeline = app.eventSourcing.getPipeline(
      pipelineName as never,
    ) as unknown as { commands: Record<string, StagedSender> };
    return pipeline.commands[name] ?? null;
  } catch {
    return null;
  }
}

/** The pipeline's sender for one command, off the App as it stands now. */
export function appPipelineSender({
  pipelineName,
}: {
  pipelineName: string;
}): (name: string) => StagedSender | null {
  return (name) => senderOn({ app: tryGetApp(), pipelineName, name });
}

/**
 * The same, waiting for the App handle first.
 *
 * The wait is why this is async: a ceremony can reach here while the App is
 * still composing, and refusing then would fail it over a race rather than a
 * defect.
 */
export function awaitedAppPipelineSender({
  pipelineName,
}: {
  pipelineName: string;
}): (name: string) => Promise<StagedSender | null> {
  return async (name) =>
    senderOn({ app: await awaitAppHandle(), pipelineName, name });
}

/** The durable append a ledger runs before it stages. */
export interface WaitedAppend<TEvent extends Event> {
  /** Production resolves the App's event store lazily; tests hand one in. */
  eventStore(): Promise<EventStore<TEvent>>;
  aggregateType: AggregateType;
}

/** The bounded read-your-writes wait a ledger runs after it stages. */
export interface ReadYourWritesWait<TState> {
  projectionStore: StateProjectionStore<TState>;
  timeoutMs: number;
  pollMs: number;
  /** The window expired. The ledger says so in its own words and metrics. */
  onTimeout(args: { aggregateId: string; eventCount: number }): void;
  /** The projection could not be read; the wait stops rather than fails. */
  onUnreadableProjection(args: { aggregateId: string; error: unknown }): void;
}

export interface StagedLedgerWriterOptions<TEvent extends Event, TState> {
  stagedSender: StagedSenderPort;
  /** `null` when the staged command is this ledger's sole appender. */
  waitedAppend: WaitedAppend<TEvent> | null;
  /** `null` when nothing reads this ledger's projection back on the spot. */
  readYourWrites: ReadYourWritesWait<TState> | null;
}

/** The least a command has to be for a ledger to stage it. */
export interface StagedLedgerCommand {
  type: string;
  data: unknown;
}

/**
 * The three legs, once. A subclass sequences them in its own `commit`,
 * because what a ceremony returns, which guard vetoes it and whether a
 * failure is loud belong to the ledger, not to the machinery.
 */
export abstract class StagedLedgerWriter<
  TCommand extends StagedLedgerCommand,
  TEvent extends Event = Event,
  TState = never,
> {
  private readonly stagedSender: StagedSenderPort;
  private readonly waitedAppend: WaitedAppend<TEvent> | null;
  private readonly readYourWrites: ReadYourWritesWait<TState> | null;

  protected constructor(options: StagedLedgerWriterOptions<TEvent, TState>) {
    this.stagedSender = options.stagedSender;
    this.waitedAppend = options.waitedAppend;
    this.readYourWrites = options.readYourWrites;
  }

  /** The pipeline sender name this ledger's command is staged under. */
  protected abstract senderNameFor(command: TCommand): string;

  /**
   * What this ledger does when the pipeline exposes no sender for a command
   * type it declares. A wiring defect either way; whether it is loud is the
   * ledger's call, because for one of them a refused write must not refuse
   * the request that occasioned it.
   */
  protected abstract onMissingSender(args: {
    command: TCommand;
    senderName: string;
  }): void;

  /**
   * The durable append, for a ledger whose fact must land before the caller
   * returns. One that named no append never calls this.
   */
  protected async append({
    events,
    tenantId,
  }: {
    events: TEvent[];
    tenantId: string;
  }): Promise<void> {
    const append = this.waitedAppend;
    if (!append) return;
    const eventStore = await append.eventStore();
    await eventStore.storeEvents(
      events,
      { tenantId: createTenantId(tenantId) },
      append.aggregateType,
    );
  }

  /**
   * The command handed to the queue, which for most of these ledgers is where
   * the append happens too.
   */
  protected async stage({ command }: { command: TCommand }): Promise<void> {
    const senderName = this.senderNameFor(command);
    const sender = await this.stagedSender(senderName);
    if (!sender) {
      this.onMissingSender({ command, senderName });
      return;
    }
    await sender.send(command.data);
  }

  /**
   * Wait for the projection's cursor to reach the last event the guard
   * decided. The same comparison the fold uses to decide an event is already
   * applied, read here instead of written — which is what makes this an
   * observation of the queue's work rather than a second writer racing it.
   *
   * A ledger that named no wait returns immediately.
   */
  protected async awaitConvergence({
    aggregateId,
    tenantId,
    events,
  }: {
    aggregateId: string;
    tenantId: string;
    events: TEvent[];
  }): Promise<void> {
    const wait = this.readYourWrites;
    if (!wait) return;
    const last = events[events.length - 1];
    if (!last) return;
    const context = {
      aggregateId,
      tenantId: createTenantId(tenantId),
    };
    // Wall-clock, not injectable business time: a frozen test clock would
    // otherwise make this loop unable to time out.
    const deadline = Date.now() + wait.timeoutMs;
    for (;;) {
      if (await this.foldReached({ wait, aggregateId, context, last })) return;
      if (Date.now() >= deadline) {
        wait.onTimeout({ aggregateId, eventCount: events.length });
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, wait.pollMs));
    }
  }

  private async foldReached({
    wait,
    aggregateId,
    context,
    last,
  }: {
    wait: ReadYourWritesWait<TState>;
    aggregateId: string;
    context: {
      aggregateId: string;
      tenantId: ReturnType<typeof createTenantId>;
    };
    last: TEvent;
  }): Promise<boolean> {
    try {
      const stored = await wait.projectionStore.load(aggregateId, context);
      const cursor = stored?.cursor;
      if (!cursor) return false;
      return (
        cursor.acceptedAt > last.createdAt ||
        (cursor.acceptedAt === last.createdAt && cursor.eventId >= last.id)
      );
    } catch (error) {
      // An unreadable projection is not a failed write: the facts are
      // durable. Stop waiting and let the caller proceed.
      wait.onUnreadableProjection({ aggregateId, error });
      return true;
    }
  }
}

/* -------------------------------------------------------------------------- */
/* The convergent ledger, written once                                        */
/* -------------------------------------------------------------------------- */

/**
 * Every convergent ledger, as configuration rather than as another copy.
 *
 * WHY THIS EXISTS. The docblock at the top of this file has always claimed to
 * be "the machinery the five identity ledger writers share" — but it was
 * extracted FROM those writers and only two of the five were ever moved onto
 * it. The join-request, SSO-connection and directory-sync writers stayed as
 * the originals it was generalised from, so the machinery existed twice: once
 * here as a base class, and once more in each of them, character for
 * character. The App-handle wait, the sender lookup, the append, the
 * convergence loop and the cursor comparison were all four copies of the same
 * twenty lines, and the three copies had no test of their own.
 *
 * Their PORTS say as much. `JoinRequestLedger`, `SsoConnectionLedger` and
 * `MfaLedger` each describe their implementation in prose as "exactly the
 * shape the identity, connection and grants ledgers already have" — three
 * interfaces asserting they are the same shape is the shape asking to be one
 * implementation.
 *
 * So it is one. What actually differs between these ledgers is not behaviour,
 * it is six values: which pipeline stages them, which aggregate they append
 * under, which envelope turns a command into events, which field of the
 * command names the aggregate, what they call themselves, and how long they
 * are willing to wait. All six are below.
 *
 * What is NOT here, deliberately: the identity ledger keeps its own subclass.
 * Its commit writes a newborn's provisional heads before staging, so the
 * front door can route an address while the fold is still queued. That is a
 * different sequence, not a different configuration, and flattening it into
 * this one would be the kind of sharing that has to be undone later.
 */
export interface ConvergentLedgerSpec<
  TCommand extends StagedLedgerCommand & { data: { tenantId: string } },
  TEvent extends Event,
  TFactInput,
> {
  /** What this ledger calls itself in the errors and log lines it raises. */
  noun: string;
  /** The logger name, kept per ledger so its lines stay filterable. */
  loggerName: string;
  /** The pipeline whose senders stage this ledger's commands. */
  pipelineName: string;
  /** The aggregate the durable append writes under. */
  aggregateType: AggregateType;
  /** This ledger's command type to pipeline sender name. */
  senderNames: Readonly<Record<TCommand["type"], string>>;
  /** The envelope that turns a command and its decided facts into events. */
  eventsFor: (args: { command: TCommand; facts: TFactInput[] }) => TEvent[];
  /** Which field of `command.data` names the aggregate. */
  aggregateIdOf: (command: TCommand) => string;
  /**
   * What that field is CALLED in log lines. Uniform `aggregateId` would read
   * worse for an operator and would silently rename a field somebody may
   * already be filtering on, so each ledger keeps its own noun.
   */
  aggregateIdField: string;
}

/**
 * A ledger whose commit is the three legs in their usual order: append the
 * facts durably, stage the command onto its aggregate's queue lane, then wait
 * — bounded — for the projection to catch up with what was just decided.
 *
 * The wait is an OBSERVATION, not inline processing. A fold that cannot run
 * makes it time out; the facts are still durable, the caller still succeeds,
 * and the rows appear when the queue drains.
 */
export class ConvergentLedgerWriter<
  TCommand extends StagedLedgerCommand & { data: { tenantId: string } },
  TEvent extends Event,
  TState,
  TFactInput,
  TFact,
> extends StagedLedgerWriter<TCommand, TEvent, TState> {
  private readonly spec: ConvergentLedgerSpec<TCommand, TEvent, TFactInput>;

  constructor({
    spec,
    projectionStore,
    convergence,
    eventStore,
    stagedSender,
  }: {
    spec: ConvergentLedgerSpec<TCommand, TEvent, TFactInput>;
    projectionStore: StateProjectionStore<TState>;
    convergence: { timeoutMs: number; pollMs: number };
    /** Production resolves the App's event store lazily; tests hand one in. */
    eventStore?: () => Promise<EventStore<TEvent>>;
    stagedSender?: StagedSenderPort;
  }) {
    const logger = createLogger(spec.loggerName);
    super({
      stagedSender:
        stagedSender ?? appPipelineSender({ pipelineName: spec.pipelineName }),
      waitedAppend: {
        eventStore:
          eventStore ??
          (() =>
            resolveAppEventStore<TEvent>({
              unavailableMessage: `${spec.noun} ledger cannot append: the event-sourcing stack is unavailable`,
            })),
        aggregateType: spec.aggregateType,
      },
      readYourWrites: {
        projectionStore,
        timeoutMs: convergence.timeoutMs,
        pollMs: convergence.pollMs,
        onTimeout: ({ aggregateId, eventCount }) => {
          logger.warn(
            { [spec.aggregateIdField]: aggregateId, commandCount: eventCount },
            `${spec.noun} projection did not land a command's events within the read-your-writes window; the append is durable and the fold will converge`,
          );
        },
        onUnreadableProjection: ({ aggregateId, error }) => {
          logger.warn(
            { [spec.aggregateIdField]: aggregateId, error },
            `could not read the ${spec.noun} projection while waiting for convergence; continuing`,
          );
        },
      },
    });
    this.spec = spec;
  }

  protected senderNameFor(command: TCommand): string {
    return this.spec.senderNames[command.type as TCommand["type"]];
  }

  protected onMissingSender({ senderName }: { senderName: string }): never {
    // A wiring defect, not a transient: the pipeline exposed no sender for a
    // command type it declares. Loud, because nothing downstream folds.
    throw new Error(
      `${this.spec.noun} ledger cannot stage: the pipeline exposes no "${senderName}" sender`,
    );
  }

  async commit({
    command,
    facts,
  }: {
    command: TCommand;
    facts: TFactInput[];
  }): Promise<TFact[]> {
    const events = this.spec.eventsFor({ command, facts });
    if (events.length === 0) return [];
    const { tenantId } = command.data;

    await this.append({ events, tenantId });
    await this.stage({ command });
    await this.awaitConvergence({
      aggregateId: this.spec.aggregateIdOf(command),
      tenantId,
      events,
    });
    // The one cast, in one place. An event IS the fact it records; the two
    // types differ only in which package names them.
    return events as unknown as TFact[];
  }
}
