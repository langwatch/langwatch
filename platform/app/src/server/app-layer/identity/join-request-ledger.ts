/**
 * The join-request ledger writer, as a declaration.
 *
 * The three legs this performs — the durable append, the command staged onto
 * the per-request GroupQueue, the bounded read-your-writes wait — are
 * `ConvergentLedgerWriter`'s, shared with the connection and two-step
 * verification ledgers rather than copied into each. What is below is only
 * what makes this ledger THIS ledger.
 *
 * The wait matters more here than elsewhere, which is why the window is named
 * rather than inherited: an admin who clicks Approve and is returned to a
 * panel still showing the request believes the click did nothing.
 */
import {
  APPROVE_JOIN_COMMAND_TYPE,
  EXPIRE_JOIN_COMMAND_TYPE,
  type JoinRequestCommand,
  type JoinRequestFact,
  type JoinRequestFactInput,
  REJECT_JOIN_COMMAND_TYPE,
  REQUEST_JOIN_COMMAND_TYPE,
  WITHDRAW_JOIN_COMMAND_TYPE,
} from "@langwatch/identity";
import type { JoinRequestLedger } from "@langwatch/identity-server";
import type { AggregateType } from "~/server/event-sourcing/domain/aggregateType";
import { joinRequestEventsFor } from "~/server/event-sourcing/pipelines/join-requests/envelope";
import type { JoinRequestFoldState } from "~/server/event-sourcing/pipelines/join-requests/projections/joinRequestState.foldProjection";
import {
  JOIN_REQUEST_AGGREGATE_TYPE,
  JOIN_REQUEST_PIPELINE_NAME,
} from "~/server/event-sourcing/pipelines/join-requests/schemas/constants";
import type { JoinRequestEvent } from "~/server/event-sourcing/pipelines/join-requests/schemas/events";
import type { StateProjectionStore } from "~/server/event-sourcing/projections/stateProjection.types";
import type { EventStore } from "~/server/event-sourcing/stores/eventStore.types";
import {
  ConvergentLedgerWriter,
  type ConvergentLedgerSpec,
  type StagedSenderPort,
} from "./staged-ledger-writer";

/** The read-your-writes window, the identity ledger's convergence shape. */
export const JOIN_REQUEST_CONVERGENCE_TIMEOUT_MS = 2_000;
export const JOIN_REQUEST_CONVERGENCE_POLL_MS = 25;

const JOIN_REQUEST_LEDGER_SPEC: ConvergentLedgerSpec<
  JoinRequestCommand,
  JoinRequestEvent,
  JoinRequestFactInput
> = {
  noun: "join request",
  loggerName: "langwatch:identity:join-request-ledger",
  pipelineName: JOIN_REQUEST_PIPELINE_NAME,
  aggregateType: JOIN_REQUEST_AGGREGATE_TYPE as AggregateType,
  senderNames: {
    [REQUEST_JOIN_COMMAND_TYPE]: "requestJoin",
    [APPROVE_JOIN_COMMAND_TYPE]: "approveJoin",
    [REJECT_JOIN_COMMAND_TYPE]: "rejectJoin",
    [WITHDRAW_JOIN_COMMAND_TYPE]: "withdrawJoin",
    [EXPIRE_JOIN_COMMAND_TYPE]: "expireJoin",
  },
  eventsFor: joinRequestEventsFor,
  aggregateIdOf: (command) => command.data.joinRequestId,
  aggregateIdField: "joinRequestId",
};

export interface JoinRequestLedgerWriterDeps {
  projectionStore: StateProjectionStore<JoinRequestFoldState>;
  /** Production resolves the App's event store lazily; tests hand one in. */
  eventStore?: () => Promise<EventStore<JoinRequestEvent>>;
  stagedSender?: StagedSenderPort;
  convergence?: { timeoutMs: number; pollMs: number };
}

export class JoinRequestLedgerWriter
  extends ConvergentLedgerWriter<
    JoinRequestCommand,
    JoinRequestEvent,
    JoinRequestFoldState,
    JoinRequestFactInput,
    JoinRequestFact
  >
  implements JoinRequestLedger
{
  constructor(deps: JoinRequestLedgerWriterDeps) {
    super({
      spec: JOIN_REQUEST_LEDGER_SPEC,
      projectionStore: deps.projectionStore,
      convergence: deps.convergence ?? {
        timeoutMs: JOIN_REQUEST_CONVERGENCE_TIMEOUT_MS,
        pollMs: JOIN_REQUEST_CONVERGENCE_POLL_MS,
      },
      eventStore: deps.eventStore,
      stagedSender: deps.stagedSender,
    });
  }
}
