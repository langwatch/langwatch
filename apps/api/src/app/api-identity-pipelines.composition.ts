/**
 * The four identity pipelines this process PRODUCES commands on. identity          a
 * person's thirteen identifier and two-step writes join-requests     the five verbs a
 * join request has sso-connections   the fourteen a federated connection has scim-sync
 */
import type { EventSourcing } from "@langwatch/eventing";
import type { Logger } from "@langwatch/observability";
import { IdentityProducerPipelinesAdapter } from "@langwatch/identity-server";
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
   * No Eventing: every identity, join-request, connection and directory-sync write
   * refuses. Named rather than silent because an absent sender is never "nothing
   * happened": each ledger stages, and a staged command with no sender THROWS by name.
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
 */
export class ApiIdentityPipelines {
  static create(senders: Map<string, Map<string, ApiIdentityCommandSender>>): ApiIdentityPipelines {
    return new ApiIdentityPipelines(senders);
  }

  private constructor(
    private readonly senders: Map<string, Map<string, ApiIdentityCommandSender>>,
  ) {}

  /**
   * One command's dispatcher, or `null` where this process registered no such pipeline.
   */
  tryCommand(input: { pipeline: string; command: string }): ApiIdentityCommandSender | null {
    return this.senders.get(input.pipeline)?.get(input.command) ?? null;
  }
}

/**
 * Registers the four definitions producer-only and resolves their senders. With no
 * Eventing the registry is empty and every write refuses BY NAME through the ledger that
 * asked, which is the behaviour a deployment with no Redis already has.
 */
export function composeApiIdentityPipelines(
  options: ApiIdentityPipelinesOptions,
): ApiIdentityPipelines {
  const { eventing, processName } = options;
  if (!eventing) {
    options.report?.withoutQueue();
    return ApiIdentityPipelines.create(new Map());
  }

  const producers = IdentityProducerPipelinesAdapter.create({ processName });
  const senders = new Map<string, Map<string, ApiIdentityCommandSender>>();
  senders.set(
    IDENTITY_PIPELINE_NAME,
    resolveSenders({
      pipeline: IDENTITY_PIPELINE_NAME,
      registered: eventing.register(producers.identityPipeline()),
      expected: IDENTITY_COMMAND_NAMES,
    }),
  );
  senders.set(
    JOIN_REQUEST_PIPELINE_NAME,
    resolveSenders({
      pipeline: JOIN_REQUEST_PIPELINE_NAME,
      registered: eventing.register(producers.joinRequestPipeline()),
      expected: JOIN_REQUEST_COMMAND_NAMES,
    }),
  );
  senders.set(
    SSO_CONNECTION_PIPELINE_NAME,
    resolveSenders({
      pipeline: SSO_CONNECTION_PIPELINE_NAME,
      registered: eventing.register(producers.ssoConnectionPipeline()),
      expected: SSO_CONNECTION_COMMAND_NAMES,
    }),
  );
  senders.set(
    SCIM_SYNC_PIPELINE_NAME,
    resolveSenders({
      pipeline: SCIM_SYNC_PIPELINE_NAME,
      registered: eventing.register(producers.scimSyncPipeline()),
      expected: SCIM_SYNC_COMMAND_NAMES,
    }),
  );

  return ApiIdentityPipelines.create(senders);
}

/**
 * Reads one registration's senders, FAILING AT BOOT for a command it did not produce.
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
 * The thirteen identity verbs, listed once. A list rather than a trusted read of whatever
 * the registration happened to expose, so a command REMOVED from the packaged definition
 * fails this process's boot rather than one person's sign-in ceremony.
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
 * Names the one identity-side absence, at boot. `info` rather than `warn`: a deployment
 * with no Redis has already been told it has no queue, and every write on these four
 * pipelines refuses BY NAME when it is attempted.
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
