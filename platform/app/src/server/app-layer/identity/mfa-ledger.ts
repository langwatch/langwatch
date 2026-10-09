/**
 * The two-step verification ledger writer, as a declaration.
 *
 * The three legs this performs — the durable append, the command staged onto
 * the per-person GroupQueue, the bounded read-your-writes wait — are
 * `ConvergentLedgerWriter`'s, shared with the join-request and connection
 * ledgers rather than copied into each. What is below is only what makes this
 * ledger THIS ledger.
 *
 * It shares the identity pipeline and the identity aggregate, because it
 * shares a key: an enrollment belongs to exactly the person their identifiers
 * belong to. That is a correctness property rather than a tidiness one — the
 * queue's group key is composed from the tenant and the aggregate, so one
 * person's two-step commands and their identifier commands land in the SAME
 * lane and serialise against each other rather than racing.
 */
import {
  CONFIRM_MFA_COMMAND_TYPE,
  CONSUME_BACKUP_CODE_COMMAND_TYPE,
  DISABLE_MFA_COMMAND_TYPE,
  ENROLL_MFA_COMMAND_TYPE,
  EXPIRE_MFA_ENROLLMENT_COMMAND_TYPE,
  type MfaCommand,
  type MfaFact,
  type MfaFactInput,
  RECORD_MFA_VERIFICATION_FAILURE_COMMAND_TYPE,
  REGENERATE_BACKUP_CODES_COMMAND_TYPE,
} from "@langwatch/identity";
import type { MfaLedger } from "@langwatch/identity-server";
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
import { INTERACTIVE_READ_YOUR_WRITES } from "../_shared/read-your-writes-window";
import {
  type ConvergentLedgerSpec,
  ConvergentLedgerWriter,
  type StagedSenderPort,
} from "./staged-ledger-writer";

/**
 * Enrolling in two-step verification, confirming a code, spending a backup
 * code: a person is waiting on every one of these, so it takes the interactive
 * window. The values used to be stated here, and identically in three sibling
 * ledgers; see `_shared/read-your-writes-window.ts` for why one number could
 * not have been right for all five callers.
 */
const MFA_CONVERGENCE = INTERACTIVE_READ_YOUR_WRITES;

const MFA_LEDGER_SPEC: ConvergentLedgerSpec<
  MfaCommand,
  MfaEvent,
  MfaFactInput
> = {
  noun: "two-step verification",
  loggerName: "langwatch:identity:mfa-ledger",
  pipelineName: IDENTITY_PIPELINE_NAME,
  aggregateType: USER_IDENTITY_AGGREGATE_TYPE as AggregateType,
  senderNames: {
    [ENROLL_MFA_COMMAND_TYPE]: "enrollMfa",
    [CONFIRM_MFA_COMMAND_TYPE]: "confirmMfa",
    [EXPIRE_MFA_ENROLLMENT_COMMAND_TYPE]: "expireMfaEnrollment",
    [DISABLE_MFA_COMMAND_TYPE]: "disableMfa",
    [CONSUME_BACKUP_CODE_COMMAND_TYPE]: "consumeBackupCode",
    [REGENERATE_BACKUP_CODES_COMMAND_TYPE]: "regenerateBackupCodes",
    [RECORD_MFA_VERIFICATION_FAILURE_COMMAND_TYPE]:
      "recordMfaVerificationFailure",
  },
  eventsFor: mfaEventsFor,
  aggregateIdOf: (command) => command.data.userId,
  aggregateIdField: "userId",
};

export interface MfaLedgerWriterDeps {
  projectionStore: StateProjectionStore<MfaFoldState>;
  /** Production resolves the App's event store lazily; tests hand one in. */
  eventStore?: () => Promise<EventStore<MfaEvent>>;
  stagedSender?: StagedSenderPort;
  convergence?: { timeoutMs: number; pollMs: number };
}

export class MfaLedgerWriter
  extends ConvergentLedgerWriter<
    MfaCommand,
    MfaEvent,
    MfaFoldState,
    MfaFactInput,
    MfaFact
  >
  implements MfaLedger
{
  constructor(deps: MfaLedgerWriterDeps) {
    super({
      spec: MFA_LEDGER_SPEC,
      projectionStore: deps.projectionStore,
      convergence: deps.convergence ?? MFA_CONVERGENCE,
      eventStore: deps.eventStore,
      stagedSender: deps.stagedSender,
    });
  }
}
