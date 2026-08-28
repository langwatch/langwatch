/**
 * The SSO connection ledger writer: the app's implementation of
 * `@langwatch/identity-server`'s SsoConnectionLedger, in the shape the
 * identity and grants ledgers already have (ADR-110, ADR-101):
 *
 *   1. the durable ClickHouse append, WAITED — the fact lands before the
 *      caller returns;
 *   2. the command staged onto the per-connection GroupQueue, awaited — the
 *      fold is the queue's, and this package never applies a projection
 *      itself;
 *   3. a bounded read-your-writes wait, watching the projection's cursor
 *      reach the events just appended.
 *
 * The wait is an OBSERVATION, not inline processing. A fold that cannot run
 * makes it time out; the facts are still durable, the caller still succeeds,
 * and the row appears when the queue drains. The grandfather migration's
 * routing proof depends on this leg: it reads the projection through the
 * routing port immediately after appending, and a proof run before the fold
 * landed would hold every organization for no reason.
 *
 * Like the identity ledger, the pipeline handle is resolved lazily off the
 * App: a bare script that never composes one must still be able to import
 * the runtime.
 */
import {
  ACTIVATE_CONNECTION_COMMAND_TYPE,
  APPROVE_DOMAIN_CLAIM_COMMAND_TYPE,
  ATTEST_DOMAIN_COMMAND_TYPE,
  CLAIM_DOMAIN_COMMAND_TYPE,
  COMPLETE_TEARDOWN_COMMAND_TYPE,
  DISCARD_CONNECTION_COMMAND_TYPE,
  GRANDFATHER_CONNECTION_COMMAND_TYPE,
  REGISTER_CONNECTION_COMMAND_TYPE,
  REJECT_DOMAIN_CLAIM_COMMAND_TYPE,
  REQUEST_TEARDOWN_COMMAND_TYPE,
  REQUEST_VERIFICATION_COMMAND_TYPE,
  RESUME_CONNECTION_COMMAND_TYPE,
  type SsoConnectionCommand,
  type SsoConnectionCommandType,
  type SsoConnectionFact,
  type SsoConnectionFactInput,
  SUSPEND_CONNECTION_COMMAND_TYPE,
  VERIFY_DOMAIN_COMMAND_TYPE,
} from "@langwatch/identity";
import type { SsoConnectionLedger } from "@langwatch/identity-server";
import { createLogger } from "@langwatch/observability";
import { tryGetApp } from "~/server/app-layer/app";
import { createTenantId } from "@langwatch/eventing";
import type { AggregateType } from "~/server/event-sourcing/domain/aggregateType";
import { ssoConnectionEventsFor } from "~/server/event-sourcing/pipelines/sso-connections/envelope";
import type { SsoConnectionFoldState } from "~/server/event-sourcing/pipelines/sso-connections/projections/ssoConnectionState.foldProjection";
import {
  SSO_CONNECTION_AGGREGATE_TYPE,
  SSO_CONNECTION_PIPELINE_NAME,
} from "~/server/event-sourcing/pipelines/sso-connections/schemas/constants";
import type { SsoConnectionEvent } from "~/server/event-sourcing/pipelines/sso-connections/schemas/events";
import type { StateProjectionStore } from "~/server/event-sourcing/projections/stateProjection.types";
import type { EventStore } from "~/server/event-sourcing/stores/eventStore.types";

const logger = createLogger("langwatch:identity:sso-connection-ledger");

/** How long a command waits for the App handle before the append gives up. */
const CONNECTION_APP_HANDLE_WAIT_MS = 5_000;

/** The read-your-writes window, the identity ledger's convergence shape. */
export const SSO_CONNECTION_CONVERGENCE_TIMEOUT_MS = 2_000;
export const SSO_CONNECTION_CONVERGENCE_POLL_MS = 25;

export type SsoConnectionStagedSender = {
  send(data: unknown): Promise<unknown>;
};

const SENDER_NAME_BY_COMMAND: Record<SsoConnectionCommandType, string> = {
  [REGISTER_CONNECTION_COMMAND_TYPE]: "registerConnection",
  [CLAIM_DOMAIN_COMMAND_TYPE]: "claimDomain",
  [APPROVE_DOMAIN_CLAIM_COMMAND_TYPE]: "approveDomainClaim",
  [REJECT_DOMAIN_CLAIM_COMMAND_TYPE]: "rejectDomainClaim",
  [DISCARD_CONNECTION_COMMAND_TYPE]: "discardConnection",
  [REQUEST_VERIFICATION_COMMAND_TYPE]: "requestVerification",
  [ATTEST_DOMAIN_COMMAND_TYPE]: "attestDomain",
  [VERIFY_DOMAIN_COMMAND_TYPE]: "verifyDomain",
  [ACTIVATE_CONNECTION_COMMAND_TYPE]: "activateConnection",
  [SUSPEND_CONNECTION_COMMAND_TYPE]: "suspendConnection",
  [RESUME_CONNECTION_COMMAND_TYPE]: "resumeConnection",
  [REQUEST_TEARDOWN_COMMAND_TYPE]: "requestTeardown",
  [COMPLETE_TEARDOWN_COMMAND_TYPE]: "completeTeardown",
  [GRANDFATHER_CONNECTION_COMMAND_TYPE]: "grandfatherConnection",
};

async function resolveEventStore(): Promise<EventStore<SsoConnectionEvent>> {
  const deadline = Date.now() + CONNECTION_APP_HANDLE_WAIT_MS;
  let app = tryGetApp();
  while (!app && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 50));
    app = tryGetApp();
  }
  const eventStore = app?.eventSourcing?.isEnabled
    ? app.eventSourcing.getEventStore<SsoConnectionEvent>()
    : undefined;
  if (!eventStore) {
    // A plain Error on purpose (error doctrine): the caller cannot act on an
    // unavailable event stack, and the command degrades to a retryable
    // failure with a trace id.
    throw new Error(
      "sso connection ledger cannot append: the event-sourcing stack is unavailable",
    );
  }
  return eventStore;
}

function resolveStagedSender(name: string): SsoConnectionStagedSender | null {
  const app = tryGetApp();
  if (!app?.eventSourcing?.isEnabled) return null;
  try {
    const pipeline = app.eventSourcing.getPipeline(
      SSO_CONNECTION_PIPELINE_NAME as never,
    ) as unknown as { commands: Record<string, SsoConnectionStagedSender> };
    return pipeline.commands[name] ?? null;
  } catch {
    return null;
  }
}

export interface SsoConnectionLedgerWriterDeps {
  projectionStore: StateProjectionStore<SsoConnectionFoldState>;
  /** Production resolves the App's event store lazily; tests hand one in. */
  eventStore?: () => Promise<EventStore<SsoConnectionEvent>>;
  stagedSender?: (name: string) => SsoConnectionStagedSender | null;
  convergence?: { timeoutMs: number; pollMs: number };
}

export class SsoConnectionLedgerWriter implements SsoConnectionLedger {
  private readonly projectionStore: StateProjectionStore<SsoConnectionFoldState>;
  private readonly eventStore: () => Promise<EventStore<SsoConnectionEvent>>;
  private readonly stagedSender: (
    name: string,
  ) => SsoConnectionStagedSender | null;
  private readonly convergence: { timeoutMs: number; pollMs: number };

  constructor(deps: SsoConnectionLedgerWriterDeps) {
    this.projectionStore = deps.projectionStore;
    this.eventStore = deps.eventStore ?? resolveEventStore;
    this.stagedSender = deps.stagedSender ?? resolveStagedSender;
    this.convergence = deps.convergence ?? {
      timeoutMs: SSO_CONNECTION_CONVERGENCE_TIMEOUT_MS,
      pollMs: SSO_CONNECTION_CONVERGENCE_POLL_MS,
    };
  }

  async commit({
    command,
    facts,
  }: {
    command: SsoConnectionCommand;
    facts: SsoConnectionFactInput[];
  }): Promise<SsoConnectionFact[]> {
    const events = ssoConnectionEventsFor({ command, facts });
    if (events.length === 0) return [];
    const { connectionId, tenantId } = command.data;

    const eventStore = await this.eventStore();
    await eventStore.storeEvents(
      events,
      { tenantId: createTenantId(tenantId) },
      SSO_CONNECTION_AGGREGATE_TYPE as AggregateType,
    );

    await this.stage({ command });
    await this.awaitFold({ connectionId, tenantId, events });
    return events as unknown as SsoConnectionFact[];
  }

  private async stage({
    command,
  }: {
    command: SsoConnectionCommand;
  }): Promise<void> {
    const senderName = SENDER_NAME_BY_COMMAND[command.type];
    const sender = this.stagedSender(senderName);
    if (!sender) {
      // A wiring defect, not a transient: the pipeline exposed no sender for
      // a command type it declares. Loud, because nothing downstream folds.
      throw new Error(
        `sso connection ledger cannot stage: the pipeline exposes no "${senderName}" sender`,
      );
    }
    await sender.send(command.data);
  }

  private async awaitFold({
    connectionId,
    tenantId,
    events,
  }: {
    connectionId: string;
    tenantId: string;
    events: SsoConnectionEvent[];
  }): Promise<void> {
    const last = events[events.length - 1];
    if (!last) return;
    const context = {
      aggregateId: connectionId,
      tenantId: createTenantId(tenantId),
    };
    // Wall-clock, not injectable business time: a frozen test clock would
    // otherwise make this loop unable to time out.
    const deadline = Date.now() + this.convergence.timeoutMs;
    for (;;) {
      if (await this.foldReached({ connectionId, context, last })) return;
      if (Date.now() >= deadline) {
        logger.warn(
          { connectionId, commandCount: events.length },
          "sso connection projection did not land a command's events within the read-your-writes window; the append is durable and the fold will converge",
        );
        return;
      }
      await new Promise((resolve) =>
        setTimeout(resolve, this.convergence.pollMs),
      );
    }
  }

  private async foldReached({
    connectionId,
    context,
    last,
  }: {
    connectionId: string;
    context: {
      aggregateId: string;
      tenantId: ReturnType<typeof createTenantId>;
    };
    last: SsoConnectionEvent;
  }): Promise<boolean> {
    try {
      const stored = await this.projectionStore.load(connectionId, context);
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
        { connectionId, error },
        "could not read the sso connection projection while waiting for convergence; continuing",
      );
      return true;
    }
  }
}
