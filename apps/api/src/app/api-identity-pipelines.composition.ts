/**
 * The four identity pipelines this process PRODUCES commands on.
 *
 *   identity          a person's thirteen identifier and two-step writes
 *   join-requests     the five verbs a join request has
 *   sso-connections   the fourteen a federated connection has
 *   scim-sync         the five an Enterprise directory's push states
 *
 * ## Why this file exists
 *
 * Every one of those writes arrives HERE — somebody attaches a sign-in method,
 * asks to join an organization, or an operator attests a domain — and none of
 * them could be enqueued. Two facts kept it that way, and both are now gone.
 *
 * `join-requests` and `sso-connections` each declare a PROCESS MANAGER (the
 * reminder-and-expiry lifecycle, and the teardown grace), and the Eventing
 * runtime refused to register any pipeline declaring one unless the process
 * also held a durable `ProcessStore`. A web process holds none — an inbox,
 * outbox and wakes are the worker's work — so ONE declaration inside a
 * definition made every command on it unsendable.
 * `EventSourcingOptions.processManagerMode: "producer-only"` separates the two
 * jobs: the producer registers the definition WHOLE and the runtime declines to
 * RUN the managers, by name, once at boot.
 *
 * `identity` declares no process manager at all and was simply never registered
 * on this process. That one was the sharper failure of the two, because a
 * ledger does not append and then stage — the QUEUED RUN is what appends — so
 * with no sender its `stage` threw and every ceremony that states an identifier
 * fact failed outright.
 *
 * ## One definition, two registrations
 *
 * Each pipeline is built from `@langwatch/identity-server`'s own producer
 * variant, which supplies stand-ins for the consumer-side dependencies — the
 * Postgres heads, the guards that read them, the mail the lifecycle sends —
 * so the definition can be CONSTRUCTED and refuses by name if one is ever
 * CALLED. That is the shape `createSimulationProcessingProducerPipeline` and
 * `createTraceProcessingProducerPipeline` already have on this process.
 *
 * Registering the packaged definition rather than a local one is what keeps the
 * routing triple every job carries identical to the one the worker routes on.
 * Two descriptions of one event stream drift into jobs nothing can pick up, and
 * the queue rejects an unroutable job for redelivery rather than dropping it —
 * so a fork here is a queue that grows forever while the pods stay up.
 *
 * ## Nothing is appended here, and that is the design
 *
 * All four ledgers STAGE and stop (ADR-110, ADR-116): the queued run re-runs
 * the same guard the calling path ran and appends what it decides, so the
 * calling path appending as well would write every fact twice. That is why a
 * producer needs no event log — not a gap it is missing one. This process's
 * store is `EventStoreProducerOnly` and refuses `storeEvents` by name, which
 * is the structural half of the same ruling.
 *
 * `JoinRequestLedgerWriter` was one correction behind: it appended before
 * staging, so on this tier every join verb failed at the door with an
 * unhandled `ConfigurationError` — a generic "unknown error" for a request the
 * worker could serve. It stages now, like its three siblings.
 *
 * `ScimSyncLedgerWriter` took the same correction, and its swallow is the one
 * difference between them: a directory's push must never fail because its
 * history could not be written, so a loss there is logged rather than raised.
 *
 * ## `scim-sync` is registered here too, and that is what keeps the history
 *
 * `api-scim.composition.ts` composes `ScimSyncLedgerWriter` on every deployment
 * holding the Enterprise application, and this registration is the sender it
 * stages through. Without it the writer had nowhere to stage: it said so at
 * `error`, named the pipeline, and let the push through — so a directory's
 * history was lost permanently rather than transiently.
 *
 * It is the ONE of the four that declares no process manager and needs none
 * declined: a push is the DIRECTORY's to retry on its own schedule, so the
 * aggregate keeps no wake of its own. The worker registers and drains the
 * consumer side unconditionally (`ScimSyncWorkerFeatureInstaller`), so a
 * command staged here has a drain the moment it lands.
 */
import type { EventSourcing } from "@langwatch/eventing";
import type { Logger } from "@langwatch/observability";
import {
  createIdentityProducerPipeline,
  createJoinRequestProducerPipeline,
  createScimSyncProducerPipeline,
  createSsoConnectionProducerPipeline,
} from "@langwatch/identity-server";
import {
  IDENTITY_PIPELINE_NAME,
  JOIN_REQUEST_PIPELINE_NAME,
  SCIM_SYNC_PIPELINE_NAME,
  SSO_CONNECTION_PIPELINE_NAME,
} from "@langwatch/identity-contract";

/** The one shape a command dispatcher has, checked rather than asserted. */
export type ApiIdentityCommandSender = { send(data: unknown): Promise<unknown> };

const isSender = (value: unknown): value is ApiIdentityCommandSender =>
  typeof value === "object" &&
  value !== null &&
  typeof (value as ApiIdentityCommandSender).send === "function";

/** Reports the composition decisions an absent queue would otherwise hide. */
export abstract class ApiIdentityPipelinesAbsenceReport {
  /**
   * No Eventing: every identity, join-request, connection and directory-sync
   * write refuses.
   *
   * Named rather than silent because an absent sender is never "nothing
   * happened": each ledger stages, and a staged command with no sender THROWS
   * by name. A deployment reads that at boot rather than in one person's
   * ceremony.
   */
  abstract withoutQueue(): void;
}

export type ApiIdentityPipelinesOptions = Readonly<{
  /**
   * The producer-only eventing runtime the four definitions are registered
   * on, or `undefined` where this process composed no queue.
   */
  eventing: EventSourcing | undefined;
  /** Names this process in a producer stand-in's refusal. */
  processName: string;
  report?: ApiIdentityPipelinesAbsenceReport;
}>;

/**
 * The command dispatchers the identity ledgers stage through.
 *
 * A registry resolved at BOOT rather than a lazy lookup per send: a pipeline
 * that registered without a command the ledger names is a composition error,
 * and the two ledgers turn a missing sender into a failed ceremony for one
 * person rather than a failed boot for the deployment.
 */
export class ApiIdentityPipelines {
  static create(senders: Map<string, Map<string, ApiIdentityCommandSender>>): ApiIdentityPipelines {
    return new ApiIdentityPipelines(senders);
  }

  private constructor(
    private readonly senders: Map<string, Map<string, ApiIdentityCommandSender>>,
  ) {}

  /**
   * One command's dispatcher, or `null` where this process registered no such
   * pipeline.
   *
   * `null` for an unregistered PIPELINE and `null` for an unknown COMMAND are
   * the same answer on purpose: the caller is what knows whether that is a
   * delay it can absorb or a refusal it must state.
   */
  tryCommand(input: { pipeline: string; command: string }): ApiIdentityCommandSender | null {
    return this.senders.get(input.pipeline)?.get(input.command) ?? null;
  }
}

/**
 * Registers the four definitions producer-only and resolves their senders.
 *
 * With no Eventing the registry is empty and every write refuses BY NAME
 * through the ledger that asked, which is the behaviour a deployment with no
 * Redis already has.
 */
export function composeApiIdentityPipelines(
  options: ApiIdentityPipelinesOptions,
): ApiIdentityPipelines {
  const { eventing, processName } = options;
  if (!eventing) {
    options.report?.withoutQueue();
    return ApiIdentityPipelines.create(new Map());
  }

  const senders = new Map<string, Map<string, ApiIdentityCommandSender>>();
  senders.set(
    IDENTITY_PIPELINE_NAME,
    resolveSenders({
      pipeline: IDENTITY_PIPELINE_NAME,
      registered: eventing.register(createIdentityProducerPipeline({ processName })),
      expected: IDENTITY_COMMAND_NAMES,
    }),
  );
  senders.set(
    JOIN_REQUEST_PIPELINE_NAME,
    resolveSenders({
      pipeline: JOIN_REQUEST_PIPELINE_NAME,
      registered: eventing.register(createJoinRequestProducerPipeline({ processName })),
      expected: JOIN_REQUEST_COMMAND_NAMES,
    }),
  );
  senders.set(
    SSO_CONNECTION_PIPELINE_NAME,
    resolveSenders({
      pipeline: SSO_CONNECTION_PIPELINE_NAME,
      registered: eventing.register(createSsoConnectionProducerPipeline({ processName })),
      expected: SSO_CONNECTION_COMMAND_NAMES,
    }),
  );
  senders.set(
    SCIM_SYNC_PIPELINE_NAME,
    resolveSenders({
      pipeline: SCIM_SYNC_PIPELINE_NAME,
      registered: eventing.register(createScimSyncProducerPipeline({ processName })),
      expected: SCIM_SYNC_COMMAND_NAMES,
    }),
  );

  return ApiIdentityPipelines.create(senders);
}

/**
 * Reads one registration's senders, FAILING AT BOOT for a command it did not
 * produce.
 *
 * Naming the missing command at boot rather than at the first dispatch is the
 * whole reason the expected names are listed: an incompletely registered
 * pipeline is a composition error, and finding it when somebody presses the
 * button means finding it in their session.
 */
function resolveSenders(input: {
  pipeline: string;
  registered: { commands: unknown };
  expected: readonly string[];
}): Map<string, ApiIdentityCommandSender> {
  const commands = input.registered.commands as Record<string, unknown>;
  const resolved = new Map<string, ApiIdentityCommandSender>();
  for (const name of input.expected) {
    const sender = commands[name];
    if (!isSender(sender)) {
      throw new Error(
        `The ${input.pipeline} registration produced no "${name}" command sender; the pipeline was registered incompletely.`,
      );
    }
    resolved.set(name, sender);
  }
  return resolved;
}

/**
 * The thirteen identity verbs, listed once.
 *
 * A list rather than a trusted read of whatever the registration happened to
 * expose, so a command REMOVED from the packaged definition fails this
 * process's boot rather than one person's sign-in ceremony.
 */
const IDENTITY_COMMAND_NAMES = [
  "attachIdentifier",
  "verifyIdentifier",
  "markPrimary",
  "detachIdentifier",
  "eraseUser",
  "proposeLink",
  "enrollMfa",
  "confirmMfa",
  "expireMfaEnrollment",
  "disableMfa",
  "consumeBackupCode",
  "regenerateBackupCodes",
  "recordMfaVerificationFailure",
] as const;

/** The five verbs a join request has. `expireJoin` is the lifecycle's own. */
const JOIN_REQUEST_COMMAND_NAMES = [
  "requestJoin",
  "approveJoin",
  "rejectJoin",
  "withdrawJoin",
  "expireJoin",
] as const;

/**
 * The five an Enterprise directory's push states.
 *
 * Every one of them is sent from this tier — the SCIM boundary is a web
 * request an identity provider makes — and none is sent from anywhere else, so
 * an absent sender here is a history nobody writes rather than a delay.
 */
const SCIM_SYNC_COMMAND_NAMES = [
  "issueScimToken",
  "recordScimUserPush",
  "recordScimGroupMapping",
  "recordScimApplyFailure",
  "revokeScimSync",
] as const;

/** The fourteen a connection has. */
const SSO_CONNECTION_COMMAND_NAMES = [
  "registerConnection",
  "claimDomain",
  "approveDomainClaim",
  "rejectDomainClaim",
  "discardConnection",
  "requestVerification",
  "attestDomain",
  "verifyDomain",
  "activateConnection",
  "suspendConnection",
  "resumeConnection",
  "requestTeardown",
  "completeTeardown",
  "grandfatherConnection",
] as const;

/**
 * Names the one identity-side absence, at boot.
 *
 * `info` rather than `warn`: a deployment with no Redis has already been told
 * it has no queue, and every write on these four pipelines refuses BY NAME
 * when it is attempted. There is no second absence to report — a producer
 * holding no event log is the ruling working, not a capability missing.
 */
export class LoggedApiIdentityPipelinesAbsence extends ApiIdentityPipelinesAbsenceReport {
  static create(logger: Pick<Logger, "info">): LoggedApiIdentityPipelinesAbsence {
    return new LoggedApiIdentityPipelinesAbsence(logger);
  }

  private constructor(private readonly logger: Pick<Logger, "info">) {
    super();
  }

  withoutQueue(): void {
    this.logger.info(
      { reason: "no-queue" },
      "API composed no Group Queue, so it registered no identity pipeline: attaching a sign-in method, asking to join an organization, every single sign-on connection command and every directory-sync fact refuse by name",
    );
  }
}
