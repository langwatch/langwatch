/**
 * The SSO connection ledger writer, as a declaration.
 *
 * The three legs this performs — the durable append, the command staged onto
 * the per-connection GroupQueue, the bounded read-your-writes wait — are
 * `ConvergentLedgerWriter`'s, shared with the join-request and two-step
 * verification ledgers rather than copied into each. What is below is only
 * what makes this ledger THIS ledger.
 *
 * The grandfather migration's routing proof depends on the wait: it reads the
 * projection through the routing port immediately after appending, and a proof
 * run before the fold landed would hold every organization for no reason.
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
  type SsoConnectionFact,
  type SsoConnectionFactInput,
  SUSPEND_CONNECTION_COMMAND_TYPE,
  VERIFY_DOMAIN_COMMAND_TYPE,
} from "@langwatch/identity";
import type { SsoConnectionLedger } from "@langwatch/identity-server";
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
import {
  ConvergentLedgerWriter,
  type ConvergentLedgerSpec,
  type StagedSenderPort,
} from "./staged-ledger-writer";
import { INTERACTIVE_READ_YOUR_WRITES } from "../_shared/read-your-writes-window";

/**
 * An administrator is configuring a connection and watching the form, so this
 * takes the interactive window. The values used to be stated here, and
 * identically in three sibling ledgers; see
 * `_shared/read-your-writes-window.ts` for why one number could not have been
 * right for all five callers.
 */
const SSO_CONNECTION_CONVERGENCE = INTERACTIVE_READ_YOUR_WRITES;

const SSO_CONNECTION_LEDGER_SPEC: ConvergentLedgerSpec<
  SsoConnectionCommand,
  SsoConnectionEvent,
  SsoConnectionFactInput
> = {
  noun: "sso connection",
  loggerName: "langwatch:identity:sso-connection-ledger",
  pipelineName: SSO_CONNECTION_PIPELINE_NAME,
  aggregateType: SSO_CONNECTION_AGGREGATE_TYPE as AggregateType,
  senderNames: {
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
  },
  eventsFor: ssoConnectionEventsFor,
  aggregateIdOf: (command) => command.data.connectionId,
  aggregateIdField: "connectionId",
};

export interface SsoConnectionLedgerWriterDeps {
  projectionStore: StateProjectionStore<SsoConnectionFoldState>;
  /** Production resolves the App's event store lazily; tests hand one in. */
  eventStore?: () => Promise<EventStore<SsoConnectionEvent>>;
  stagedSender?: StagedSenderPort;
  convergence?: { timeoutMs: number; pollMs: number };
}

export class SsoConnectionLedgerWriter
  extends ConvergentLedgerWriter<
    SsoConnectionCommand,
    SsoConnectionEvent,
    SsoConnectionFoldState,
    SsoConnectionFactInput,
    SsoConnectionFact
  >
  implements SsoConnectionLedger
{
  constructor(deps: SsoConnectionLedgerWriterDeps) {
    super({
      spec: SSO_CONNECTION_LEDGER_SPEC,
      projectionStore: deps.projectionStore,
      convergence: deps.convergence ?? SSO_CONNECTION_CONVERGENCE,
      eventStore: deps.eventStore,
      stagedSender: deps.stagedSender,
    });
  }
}
