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
import {
  appPipelineSender,
  resolveAppEventStore,
  StagedLedgerWriter,
  type StagedSender,
} from "./staged-ledger-writer";

const logger = createLogger("langwatch:identity:mfa-ledger");

/** The read-your-writes window, the identity ledger's convergence shape. */
export const MFA_CONVERGENCE_TIMEOUT_MS = 2_000;
export const MFA_CONVERGENCE_POLL_MS = 25;

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
  return resolveAppEventStore<MfaEvent>({
    unavailableMessage:
      "two-step verification ledger cannot append: the event-sourcing stack is unavailable",
  });
}

const resolveStagedSender = appPipelineSender({
  pipelineName: IDENTITY_PIPELINE_NAME,
});

export interface MfaLedgerWriterDeps {
  projectionStore: StateProjectionStore<MfaFoldState>;
  /** Production resolves the App's event store lazily; tests hand one in. */
  eventStore?: () => Promise<EventStore<MfaEvent>>;
  stagedSender?: (name: string) => StagedSender | null;
  convergence?: { timeoutMs: number; pollMs: number };
}

export class MfaLedgerWriter
  extends StagedLedgerWriter<MfaCommand, MfaEvent, MfaFoldState>
  implements MfaLedger
{
  constructor(deps: MfaLedgerWriterDeps) {
    const convergence = deps.convergence ?? {
      timeoutMs: MFA_CONVERGENCE_TIMEOUT_MS,
      pollMs: MFA_CONVERGENCE_POLL_MS,
    };
    super({
      stagedSender: deps.stagedSender ?? resolveStagedSender,
      waitedAppend: {
        eventStore: deps.eventStore ?? resolveEventStore,
        aggregateType: USER_IDENTITY_AGGREGATE_TYPE as AggregateType,
      },
      readYourWrites: {
        projectionStore: deps.projectionStore,
        timeoutMs: convergence.timeoutMs,
        pollMs: convergence.pollMs,
        onTimeout: ({ aggregateId, eventCount }) => {
          logger.warn(
            { userId: aggregateId, commandCount: eventCount },
            "two-step verification projection did not land a ceremony's events within the read-your-writes window; the append is durable and the fold will converge",
          );
        },
        onUnreadableProjection: ({ aggregateId, error }) => {
          logger.warn(
            { userId: aggregateId, error },
            "could not read the two-step verification projection while waiting for convergence; continuing",
          );
        },
      },
    });
  }

  protected senderNameFor(command: MfaCommand): string {
    return SENDER_NAME_BY_COMMAND[command.type];
  }

  protected onMissingSender({ senderName }: { senderName: string }): never {
    // A wiring defect, not a transient: the pipeline exposed no sender for
    // a command type it declares. Loud, because nothing downstream folds.
    throw new Error(
      `two-step verification ledger cannot stage: the identity pipeline exposes no "${senderName}" sender`,
    );
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

    await this.append({ events, tenantId });
    await this.stage({ command });
    await this.awaitConvergence({ aggregateId: userId, tenantId, events });
    return events as unknown as MfaFact[];
  }
}
