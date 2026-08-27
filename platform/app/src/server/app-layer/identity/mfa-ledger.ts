/**
 * The two-step verification ledger writer: the app's implementation of
 * `@langwatch/identity-server`'s MfaLedger port (D06), in the shape the
 * identity, connection and join-request ledgers already have:
 *
 *   1. the durable ClickHouse append, WAITED — the fact lands before the
 *      caller returns;
 *   2. the command staged onto the per-person GroupQueue, awaited — the fold
 *      is the queue's, and this module never applies a projection itself;
 *   3. a bounded read-your-writes wait, watching the projection's cursor
 *      reach the events just appended.
 *
 * It shares the identity pipeline and the identity aggregate, because it
 * shares a key: an enrollment belongs to exactly the person their identifiers
 * belong to. That is a correctness property rather than a tidiness one — the
 * queue's group key is composed from the tenant and the aggregate, so one
 * person's two-step commands and their identifier commands land in the SAME
 * lane and serialise against each other rather than racing.
 *
 * The wait is an OBSERVATION, not inline processing. A fold that cannot run
 * makes it time out; the facts are still durable, the caller still succeeds,
 * and the row appears when the queue drains.
 */
import {
  CONFIRM_MFA_COMMAND_TYPE,
  CONSUME_BACKUP_CODE_COMMAND_TYPE,
  DISABLE_MFA_COMMAND_TYPE,
  ENROLL_MFA_COMMAND_TYPE,
  EXPIRE_MFA_ENROLLMENT_COMMAND_TYPE,
  type MfaCommand,
  type MfaCommandType,
  type MfaFact,
  type MfaFactInput,
  RECORD_MFA_VERIFICATION_FAILURE_COMMAND_TYPE,
  REGENERATE_BACKUP_CODES_COMMAND_TYPE,
} from "@langwatch/identity";
import type { MfaLedger } from "@langwatch/identity-server";
import { createLogger } from "@langwatch/observability";
import { tryGetApp } from "~/server/app-layer/app";
import { createTenantId } from "~/server/event-sourcing";
import type { AggregateType } from "~/server/event-sourcing/domain/aggregateType";
import { mfaEventsFor } from "~/server/event-sourcing/pipelines/identity/envelope";
import type { MfaFoldState } from "~/server/event-sourcing/pipelines/identity/projections/mfaEnrollmentState.foldProjection";
import {
  IDENTITY_PIPELINE_NAME,
  USER_IDENTITY_AGGREGATE_TYPE,
} from "~/server/event-sourcing/pipelines/identity/schemas/constants";
import type { MfaEvent } from "~/server/event-sourcing/pipelines/identity/schemas/mfaEvents";
import type { StateProjectionStore } from "~/server/event-sourcing/projections/stateProjection.types";
import type { EventStore } from "~/server/event-sourcing/stores/eventStore.types";

const logger = createLogger("langwatch:identity:mfa-ledger");

/** How long a ceremony waits for the App handle before the append gives up. */
const MFA_APP_HANDLE_WAIT_MS = 5_000;

/** The read-your-writes window, the identity ledger's convergence shape. */
export const MFA_CONVERGENCE_TIMEOUT_MS = 2_000;
export const MFA_CONVERGENCE_POLL_MS = 25;

export type MfaStagedSender = {
  send(data: unknown): Promise<unknown>;
};

const SENDER_NAME_BY_COMMAND: Record<MfaCommandType, string> = {
  [ENROLL_MFA_COMMAND_TYPE]: "enrollMfa",
  [CONFIRM_MFA_COMMAND_TYPE]: "confirmMfa",
  [EXPIRE_MFA_ENROLLMENT_COMMAND_TYPE]: "expireMfaEnrollment",
  [DISABLE_MFA_COMMAND_TYPE]: "disableMfa",
  [CONSUME_BACKUP_CODE_COMMAND_TYPE]: "consumeBackupCode",
  [REGENERATE_BACKUP_CODES_COMMAND_TYPE]: "regenerateBackupCodes",
  [RECORD_MFA_VERIFICATION_FAILURE_COMMAND_TYPE]:
    "recordMfaVerificationFailure",
};

async function resolveEventStore(): Promise<EventStore<MfaEvent>> {
  const deadline = Date.now() + MFA_APP_HANDLE_WAIT_MS;
  let app = tryGetApp();
  while (!app && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 50));
    app = tryGetApp();
  }
  const eventStore = app?.eventSourcing?.isEnabled
    ? app.eventSourcing.getEventStore<MfaEvent>()
    : undefined;
  if (!eventStore) {
    // A plain Error on purpose (error doctrine): the caller cannot act on an
    // unavailable event stack, and the ceremony degrades to a retryable
    // failure with a trace id.
    throw new Error(
      "two-step verification ledger cannot append: the event-sourcing stack is unavailable",
    );
  }
  return eventStore;
}

function resolveStagedSender(name: string): MfaStagedSender | null {
  const app = tryGetApp();
  if (!app?.eventSourcing?.isEnabled) return null;
  try {
    const pipeline = app.eventSourcing.getPipeline(
      IDENTITY_PIPELINE_NAME as never,
    ) as unknown as { commands: Record<string, MfaStagedSender> };
    return pipeline.commands[name] ?? null;
  } catch {
    return null;
  }
}

export interface MfaLedgerWriterDeps {
  projectionStore: StateProjectionStore<MfaFoldState>;
  /** Production resolves the App's event store lazily; tests hand one in. */
  eventStore?: () => Promise<EventStore<MfaEvent>>;
  stagedSender?: (name: string) => MfaStagedSender | null;
  convergence?: { timeoutMs: number; pollMs: number };
}

export class MfaLedgerWriter implements MfaLedger {
  private readonly projectionStore: StateProjectionStore<MfaFoldState>;
  private readonly eventStore: () => Promise<EventStore<MfaEvent>>;
  private readonly stagedSender: (name: string) => MfaStagedSender | null;
  private readonly convergence: { timeoutMs: number; pollMs: number };

  constructor(deps: MfaLedgerWriterDeps) {
    this.projectionStore = deps.projectionStore;
    this.eventStore = deps.eventStore ?? resolveEventStore;
    this.stagedSender = deps.stagedSender ?? resolveStagedSender;
    this.convergence = deps.convergence ?? {
      timeoutMs: MFA_CONVERGENCE_TIMEOUT_MS,
      pollMs: MFA_CONVERGENCE_POLL_MS,
    };
  }

  async commit({
    command,
    facts,
  }: {
    command: MfaCommand;
    facts: MfaFactInput[];
  }): Promise<MfaFact[]> {
    const events = mfaEventsFor({ command, facts });
    if (events.length === 0) return [];
    const { userId, tenantId } = command.data;

    const eventStore = await this.eventStore();
    await eventStore.storeEvents(
      events,
      { tenantId: createTenantId(tenantId) },
      USER_IDENTITY_AGGREGATE_TYPE as AggregateType,
    );

    await this.stage({ command });
    await this.awaitFold({ userId, tenantId, events });
    return events as unknown as MfaFact[];
  }

  private async stage({ command }: { command: MfaCommand }): Promise<void> {
    const senderName = SENDER_NAME_BY_COMMAND[command.type];
    const sender = this.stagedSender(senderName);
    if (!sender) {
      // A wiring defect, not a transient: the pipeline exposed no sender for
      // a command type it declares. Loud, because nothing downstream folds.
      throw new Error(
        `two-step verification ledger cannot stage: the identity pipeline exposes no "${senderName}" sender`,
      );
    }
    await sender.send(command.data);
  }

  private async awaitFold({
    userId,
    tenantId,
    events,
  }: {
    userId: string;
    tenantId: string;
    events: MfaEvent[];
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
        logger.warn(
          { userId, commandCount: events.length },
          "two-step verification projection did not land a ceremony's events within the read-your-writes window; the append is durable and the fold will converge",
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
    last: MfaEvent;
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
        "could not read the two-step verification projection while waiting for convergence; continuing",
      );
      return true;
    }
  }
}
