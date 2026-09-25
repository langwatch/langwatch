/**
 * Builds the {@link IdentityInfrastructure} `IdentityApp.create` hands its services, from the
 * module's own rows and the process's `eventing` member plus its own config.
 */
import type { EventSourcing } from "@langwatch/eventing";
import {
  IDENTITY_PIPELINE_NAME,
  JOIN_REQUEST_PIPELINE_NAME,
  SCIM_SYNC_PIPELINE_NAME,
  SSO_CONNECTION_PIPELINE_NAME,
} from "@langwatch/identity-contract";

import {
  IdentityLedgerStore,
  type IdentityStagedSender,
} from "../eventing/identity-ledger.store.ts";
import type { IdentityEvent } from "../eventing/identity-state.projection.ts";
import { JoinRequestLedgerStore } from "../eventing/join-request-ledger.store.ts";
import type { SsoConnectionEvent } from "../eventing/sso-connection-state.projection.ts";
import {
  EventingIdentityHistoryRepository,
  type IdentityEventReads,
} from "../repositories/eventing/eventing.identity-history.repository.ts";
import {
  EventingSsoConnectionHistoryRepository,
  type SsoConnectionEventReads,
} from "../repositories/eventing/eventing.sso-connection-history.repository.ts";
import type { IdentityRepositories } from "../repositories/identity.repositories.ts";
import { isPlatformOperatorEmail } from "../rules/platform-operator.rules.ts";
import {
  IDENTITY_LATCH_CACHE_MAX_USERS,
  IDENTITY_LATCH_CACHE_TTL_MS,
} from "../services/per-subject-cached-latch.service.ts";
import type { IdentityEventing, IdentityInfrastructure } from "./identity.members.ts";

/** The one shape a command dispatcher has, checked rather than asserted. */
type IdentityCommandSender = { send(data: unknown): Promise<unknown> };

const isSender = (value: unknown): value is IdentityCommandSender =>
  typeof value === "object" &&
  value !== null &&
  typeof (value as IdentityCommandSender).send === "function";

/**
 * Reads one registration's senders, FAILING AT BOOT for a command it did not produce.
 */
function resolveSenders(input: {
  pipeline: string;
  registered: { commands: unknown };
  expected: readonly string[];
}): Map<string, IdentityCommandSender> {
  const commands = input.registered.commands as Record<string, unknown>;
  const resolved = new Map<string, IdentityCommandSender>();
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
 * The fifteen identity verbs, listed once. A list rather than a trusted read of whatever
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
  "confirmLink",
  "rejectLink",
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
 * The five an Enterprise directory's push states, and the operator's re-drive.
 */
const SCIM_SYNC_COMMAND_NAMES = [
  "issueScimToken",
  "recordScimUserPush",
  "recordScimGroupMapping",
  "recordScimApplyFailure",
  "redriveScimApply",
  "revokeScimSync",
] as const;

/** The fifteen a connection has. */
const SSO_CONNECTION_COMMAND_NAMES = [
  "registerConnection",
  "claimDomain",
  "approveDomainClaim",
  "rejectDomainClaim",
  "discardConnection",
  "requestVerification",
  "attestDomain",
  "withdrawDomain",
  "verifyDomain",
  "activateConnection",
  "suspendConnection",
  "resumeConnection",
  "requestTeardown",
  "completeTeardown",
  "grandfatherConnection",
] as const;

/** The four pipelines and the verbs each one is expected to publish. */
const EXPECTED_COMMANDS: ReadonlyMap<string, readonly string[]> = new Map<
  string,
  readonly string[]
>([
  [IDENTITY_PIPELINE_NAME, IDENTITY_COMMAND_NAMES],
  [JOIN_REQUEST_PIPELINE_NAME, JOIN_REQUEST_COMMAND_NAMES],
  [SSO_CONNECTION_PIPELINE_NAME, SSO_CONNECTION_COMMAND_NAMES],
  [SCIM_SYNC_PIPELINE_NAME, SCIM_SYNC_COMMAND_NAMES],
]);

/**
 * Identity's command senders, handed over by each of its four eventing modules as the process
 * connects them. A pipeline not yet connected answers null: not commandable on this process.
 */
export class ConnectedIdentityEventing implements IdentityEventing {
  static create(): ConnectedIdentityEventing {
    return new ConnectedIdentityEventing();
  }

  readonly #senders = new Map<string, Map<string, IdentityCommandSender>>();

  private constructor() {}

  /** Fails the install by name when a registration produced some of identity's verbs, not all. */
  connect(input: { pipeline: string; commands: object }): void {
    // A runtime with no command queue hands over no senders at all: nothing is commandable here.
    if (Object.keys(input.commands).length === 0) return;
    this.#senders.set(
      input.pipeline,
      resolveSenders({
        pipeline: input.pipeline,
        registered: { commands: input.commands },
        expected: EXPECTED_COMMANDS.get(input.pipeline) ?? [],
      }),
    );
  }

  async tryPipelineCommand(input: {
    pipeline: string;
    command: string;
  }): Promise<IdentityStagedSender | null> {
    return this.#senders.get(input.pipeline)?.get(input.command) ?? null;
  }
}

/**
 * How the history reaches this process's log, resolved per read so a stack
 * that is not up yet at compose time still answers later.
 */
function ssoConnectionHistoryStore(options: {
  eventing: EventSourcing;
}): () => Promise<SsoConnectionEventReads> {
  const { eventing } = options;
  return async () => {
    const store = eventing.getEventStore<SsoConnectionEvent>();
    if (!store) {
      // A plain Error on purpose (error doctrine): the reader cannot act on
      // an unavailable event stack, so this degrades to a retryable failure.
      throw new Error(
        "sso connection history cannot read: the event-sourcing stack is unavailable",
      );
    }
    return store;
  };
}

/** The identity log, resolved per read like the connection history above. */
function identityHistoryStore(options: {
  eventing: EventSourcing;
}): () => Promise<IdentityEventReads> {
  const { eventing } = options;
  return async () => {
    const store = eventing.getEventStore<IdentityEvent>();
    if (!store) {
      throw new Error("identity history cannot read: the event-sourcing stack is unavailable");
    }
    return store;
  };
}

/** What this process hands `IdentityApp` at boot, built from its own rows, members and config. */
export function buildIdentityInfrastructure(input: {
  repositories: Pick<
    IdentityRepositories,
    | "identityProjection"
    | "joinRequestProjection"
    | "secretCarry"
    | "joinRequestAudience"
    | "ssoPlatformOperators"
    | "scimSyncs"
  >;
  eventing: EventSourcing;
  identityEventing: ConnectedIdentityEventing;
  adminEmails: readonly string[];
}): IdentityInfrastructure {
  const { repositories, eventing, identityEventing, adminEmails } = input;

  return {
    eventing: identityEventing,
    operators: {
      isPlatformOperatorEmail: ({ email }) => isPlatformOperatorEmail({ adminEmails, email }),
    },
    latch: {
      ttlMs: IDENTITY_LATCH_CACHE_TTL_MS,
      maxUsers: IDENTITY_LATCH_CACHE_MAX_USERS,
      now: Date.now,
    },
    ledger: IdentityLedgerStore.create({
      projectionStore: repositories.identityProjection,
      eventing: identityEventing,
    }),
    joinRequestLedger: JoinRequestLedgerStore.create({
      projectionStore: repositories.joinRequestProjection,
      eventing: identityEventing,
    }),
    secrets: repositories.secretCarry,
    joinRequestAudience: repositories.joinRequestAudience,
    ssoPlatformOperators: repositories.ssoPlatformOperators,
    // Absent where this process composed no event stack: the history refuses
    // by name rather than reading as empty, which is indistinguishable from
    // a connection nothing ever happened to.
    ssoConnectionHistory: eventing.isEnabled
      ? EventingSsoConnectionHistoryRepository.create({
          eventStore: ssoConnectionHistoryStore({ eventing }),
        })
      : null,
    identityHistory: eventing.isEnabled
      ? EventingIdentityHistoryRepository.create({ eventStore: identityHistoryStore({ eventing }) })
      : null,
    scimSyncs: repositories.scimSyncs,
  };
}
