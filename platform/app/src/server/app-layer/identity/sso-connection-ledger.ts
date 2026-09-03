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
  RECORD_DOMAIN_PROOF_ABSENT_COMMAND_TYPE,
  RECORD_DOMAIN_PROOF_PRESENT_COMMAND_TYPE,
  REGISTER_CONNECTION_COMMAND_TYPE,
  REJECT_DOMAIN_CLAIM_COMMAND_TYPE,
  REQUEST_TEARDOWN_COMMAND_TYPE,
  REQUEST_VERIFICATION_COMMAND_TYPE,
  RESUME_CONNECTION_COMMAND_TYPE,
  SET_ARRIVAL_POLICY_COMMAND_TYPE,
  type SsoConnectionCommand,
  type SsoConnectionCommandType,
  type SsoConnectionFact,
  type SsoConnectionFactInput,
  SUSPEND_CONNECTION_COMMAND_TYPE,
  VERIFY_DOMAIN_COMMAND_TYPE,
  WITHDRAW_DOMAIN_COMMAND_TYPE,
} from "@langwatch/identity";
import type { SsoConnectionLedger } from "@langwatch/identity-server";
import { createLogger } from "@langwatch/observability";
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
  appPipelineSender,
  resolveAppEventStore,
  StagedLedgerWriter,
  type StagedSender,
} from "./staged-ledger-writer";

const logger = createLogger("langwatch:identity:sso-connection-ledger");

/** The read-your-writes window, the identity ledger's convergence shape. */
export const SSO_CONNECTION_CONVERGENCE_TIMEOUT_MS = 2_000;
export const SSO_CONNECTION_CONVERGENCE_POLL_MS = 25;

/** Exported for the wiring pin only: the pipeline must carry every one of
 *  these names, and the test that says so cannot read a private const. */
export const SENDER_NAME_BY_COMMAND: Record<SsoConnectionCommandType, string> =
  {
    [REGISTER_CONNECTION_COMMAND_TYPE]: "registerConnection",
    [CLAIM_DOMAIN_COMMAND_TYPE]: "claimDomain",
    [APPROVE_DOMAIN_CLAIM_COMMAND_TYPE]: "approveDomainClaim",
    [REJECT_DOMAIN_CLAIM_COMMAND_TYPE]: "rejectDomainClaim",
    [DISCARD_CONNECTION_COMMAND_TYPE]: "discardConnection",
    [REQUEST_VERIFICATION_COMMAND_TYPE]: "requestVerification",
    [ATTEST_DOMAIN_COMMAND_TYPE]: "attestDomain",
    [WITHDRAW_DOMAIN_COMMAND_TYPE]: "withdrawDomain",
    [VERIFY_DOMAIN_COMMAND_TYPE]: "verifyDomain",
    [ACTIVATE_CONNECTION_COMMAND_TYPE]: "activateConnection",
    [SUSPEND_CONNECTION_COMMAND_TYPE]: "suspendConnection",
    [RESUME_CONNECTION_COMMAND_TYPE]: "resumeConnection",
    [REQUEST_TEARDOWN_COMMAND_TYPE]: "requestTeardown",
    [COMPLETE_TEARDOWN_COMMAND_TYPE]: "completeTeardown",
    [SET_ARRIVAL_POLICY_COMMAND_TYPE]: "setArrivalPolicy",
    // The two re-check verbs the scheduler commands (ADR-123). They were
    // missing from this map, which the `Record` had been quietly tolerating
    // until another verb made the type complain about all three at once.
    [RECORD_DOMAIN_PROOF_ABSENT_COMMAND_TYPE]: "recordDomainProofAbsent",
    [RECORD_DOMAIN_PROOF_PRESENT_COMMAND_TYPE]: "recordDomainProofPresent",
    [GRANDFATHER_CONNECTION_COMMAND_TYPE]: "grandfatherConnection",
  };

async function resolveEventStore(): Promise<EventStore<SsoConnectionEvent>> {
  return resolveAppEventStore<SsoConnectionEvent>({
    unavailableMessage:
      "sso connection ledger cannot append: the event-sourcing stack is unavailable",
  });
}

const resolveStagedSender = appPipelineSender({
  pipelineName: SSO_CONNECTION_PIPELINE_NAME,
});

export interface SsoConnectionLedgerWriterDeps {
  projectionStore: StateProjectionStore<SsoConnectionFoldState>;
  /** Production resolves the App's event store lazily; tests hand one in. */
  eventStore?: () => Promise<EventStore<SsoConnectionEvent>>;
  stagedSender?: (name: string) => StagedSender | null;
  convergence?: { timeoutMs: number; pollMs: number };
}

export class SsoConnectionLedgerWriter
  extends StagedLedgerWriter<
    SsoConnectionCommand,
    SsoConnectionEvent,
    SsoConnectionFoldState
  >
  implements SsoConnectionLedger
{
  constructor(deps: SsoConnectionLedgerWriterDeps) {
    const convergence = deps.convergence ?? {
      timeoutMs: SSO_CONNECTION_CONVERGENCE_TIMEOUT_MS,
      pollMs: SSO_CONNECTION_CONVERGENCE_POLL_MS,
    };
    super({
      stagedSender: deps.stagedSender ?? resolveStagedSender,
      waitedAppend: {
        eventStore: deps.eventStore ?? resolveEventStore,
        aggregateType: SSO_CONNECTION_AGGREGATE_TYPE as AggregateType,
      },
      readYourWrites: {
        projectionStore: deps.projectionStore,
        timeoutMs: convergence.timeoutMs,
        pollMs: convergence.pollMs,
        onTimeout: ({ aggregateId, eventCount }) => {
          logger.warn(
            { connectionId: aggregateId, commandCount: eventCount },
            "sso connection projection did not land a command's events within the read-your-writes window; the append is durable and the fold will converge",
          );
        },
        onUnreadableProjection: ({ aggregateId, error }) => {
          logger.warn(
            { connectionId: aggregateId, error },
            "could not read the sso connection projection while waiting for convergence; continuing",
          );
        },
      },
    });
  }

  protected senderNameFor(command: SsoConnectionCommand): string {
    return SENDER_NAME_BY_COMMAND[command.type];
  }

  protected onMissingSender({ senderName }: { senderName: string }): never {
    // A wiring defect, not a transient: the pipeline exposed no sender for
    // a command type it declares. Loud, because nothing downstream folds.
    throw new Error(
      `sso connection ledger cannot stage: the pipeline exposes no "${senderName}" sender`,
    );
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

    await this.append({ events, tenantId });
    await this.stage({ command });
    await this.awaitConvergence({
      aggregateId: connectionId,
      tenantId,
      events,
    });
    return events as unknown as SsoConnectionFact[];
  }
}
