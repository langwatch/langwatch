/**
 * Builds the {@link IdentityInfrastructure} this module used to receive
 * hand-composed (`apps/api/src/features/identity/identity.composition.ts` and
 * `apps/api/src/app/api-identity-pipelines.composition.ts`, both deleted by
 * b383462d96). `IdentityApp.create` now builds it itself from the two members
 * it reads — `prisma` and `eventing` — plus its own config.
 */
import type { EventSourcing } from "@langwatch/eventing";
import type { ProcessMembers } from "@langwatch/infrastructure/members";
import {
  IDENTITY_PIPELINE_NAME,
  JOIN_REQUEST_PIPELINE_NAME,
  SCIM_SYNC_PIPELINE_NAME,
  SSO_CONNECTION_PIPELINE_NAME,
} from "@langwatch/identity-contract";
import { AdminEmailPlatformOperatorsRepository } from "../repositories/prisma/prisma.sso-platform-operators.repository.ts";
import { PrismaIdentityProjectionRepository } from "../repositories/prisma/prisma.identity-projection.repository.ts";
import { PrismaIdentityReservationRepository } from "../repositories/prisma/prisma.identity-reservations.repository.ts";
import { PrismaIdentitySecretCarryRepository } from "../repositories/prisma/prisma.identity-secret-carry.repository.ts";
import { PrismaJoinRequestAudienceRepository } from "../repositories/prisma/prisma.join-request-audience.repository.ts";
import { PrismaScimSyncProjectionRepository } from "../repositories/prisma/prisma.scim-sync-projection.repository.ts";
import { PrismaSsoConnectionProjectionRepository } from "../repositories/prisma/prisma.sso-connection-projection.repository.ts";
import {
  IdentityLedgerWriterAdapter,
  type IdentityStagedSender,
} from "../services/identity-ledger.service.ts";
import {
  SsoConnectionLedgerWriterAdapter,
  type SsoConnectionStagedSender,
} from "../services/eventing-sso-connection-ledger.service.ts";
import { IDENTITY_LATCH_CACHE_MAX_USERS, IDENTITY_LATCH_CACHE_TTL_MS } from "../services/per-subject-cached-latch.service.ts";
import { IdentityProducerPipelinesAdapter } from "../services/producer-identity-pipelines.service.ts";
import type { SsoConnectionEvent } from "../eventing/sso-connection-state.projection.ts";
import type { IdentityEventing, PlatformOperator } from "./identity.members.ts";
import type { IdentityAppConfig } from "./identity.app.ts";
import type { IdentityInfrastructure } from "./identity-members.ts";

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
 * This process's own producer-only registration of the four identity
 * pipelines, and the module's implementation of {@link IdentityEventing} over
 * the senders it resolved. Registering here — inside the module that reads
 * `eventing` — rather than in a process composition root is the whole point
 * of the App declaring `reads(...)`.
 */
class RegisteredIdentityEventing implements IdentityEventing {
  static create(eventing: EventSourcing): RegisteredIdentityEventing {
    const producers = IdentityProducerPipelinesAdapter.create({ processName: "identity" });
    const senders = new Map<string, Map<string, IdentityCommandSender>>();
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
    return new RegisteredIdentityEventing(senders);
  }

  private constructor(private readonly senders: Map<string, Map<string, IdentityCommandSender>>) {}

  async tryPipelineCommand(input: {
    pipeline: string;
    command: string;
  }): Promise<IdentityStagedSender | null> {
    return this.senders.get(input.pipeline)?.get(input.command) ?? null;
  }
}

/** The four pipelines and the verbs each one is expected to publish. */
const EXPECTED_COMMANDS: ReadonlyMap<string, readonly string[]> = new Map<string, readonly string[]>([
  [IDENTITY_PIPELINE_NAME, IDENTITY_COMMAND_NAMES],
  [JOIN_REQUEST_PIPELINE_NAME, JOIN_REQUEST_COMMAND_NAMES],
  [SSO_CONNECTION_PIPELINE_NAME, SSO_CONNECTION_COMMAND_NAMES],
  [SCIM_SYNC_PIPELINE_NAME, SCIM_SYNC_COMMAND_NAMES],
]);

/**
 * The senders of the four identity registrations a process makes SOMEWHERE
 * ELSE, resolved at the first send rather than at composition.
 *
 * A process that drains the ledgers composes Identity's read graph BEFORE its
 * install phase runs, and the install phase is what registers the complete
 * Postgres definitions. So there is nothing to resolve yet when this is built,
 * and there is no second registration to make: one runtime holds one pipeline
 * per name, and a producer-only definition registered beside the full one
 * would either be refused — which is what killed the combined backend boot —
 * or win the name and answer every guard read with a stand-in that refuses.
 *
 * The verb lists still gate: a command outside them answers `null` exactly as
 * the registering shape does, and a listed command missing from the process's
 * own registration THROWS by name, which is the late equivalent of that
 * shape's boot-time refusal.
 */
class ProcessRegisteredIdentityEventing implements IdentityEventing {
  static create(eventing: EventSourcing): ProcessRegisteredIdentityEventing {
    return new ProcessRegisteredIdentityEventing(eventing);
  }

  private constructor(private readonly eventing: EventSourcing) {}

  async tryPipelineCommand(input: {
    pipeline: string;
    command: string;
  }): Promise<IdentityStagedSender | null> {
    const expected = EXPECTED_COMMANDS.get(input.pipeline);
    if (!expected?.includes(input.command)) return null;
    // Throws by name when nothing has registered the pipeline yet — a caller
    // that reaches identity before the install phase is a composition-order
    // bug and says so, rather than dropping the command.
    const registered = this.eventing.getPipeline(input.pipeline);
    const sender = (registered.commands as Record<string, unknown>)[input.command];
    if (!isSender(sender)) {
      throw new Error(
        `The ${input.pipeline} registration on this process produced no "${input.command}" command sender; the pipeline was registered incompletely.`,
      );
    }
    return sender;
  }
}

/**
 * Lifted verbatim (Step 8's rule) from `postgres.sso-connection-pipeline.adapter.ts`'s
 * ledger writer, over this process's own `eventing`. Every command not
 * currently staged answers `null`, which the guards read as "not commandable
 * on this process".
 */
function ssoConnectionLedger(options: {
  prisma: ProcessMembers["prisma"];
  eventing: EventSourcing;
}): SsoConnectionLedgerWriterAdapter {
  const { prisma, eventing } = options;

  return SsoConnectionLedgerWriterAdapter.create({
    projectionStore: PrismaSsoConnectionProjectionRepository.create(prisma),
    eventStore: async () => {
      const eventStore = eventing.isEnabled
        ? eventing.getEventStore<SsoConnectionEvent>()
        : undefined;
      if (!eventStore) {
        throw new Error(
          "sso connection ledger cannot append: the event-sourcing stack is unavailable",
        );
      }
      return eventStore;
    },
    stagedSender: (name) => {
      if (!eventing.isEnabled) return null;
      try {
        const pipeline = eventing.getPipeline(SSO_CONNECTION_PIPELINE_NAME) as unknown as {
          commands: Record<string, SsoConnectionStagedSender>;
        };
        return pipeline.commands[name] ?? null;
      } catch {
        return null;
      }
    },
  });
}

/** What this process hands `IdentityApp` at boot, built from its own members and config. */
export function buildIdentityInfrastructure(input: {
  prisma: ProcessMembers["prisma"];
  eventing: EventSourcing;
  config: IdentityAppConfig;
}): IdentityInfrastructure {
  const { prisma, eventing, config } = input;
  const identityEventing = config.registersPipelines
    ? RegisteredIdentityEventing.create(eventing)
    : ProcessRegisteredIdentityEventing.create(eventing);
  const operators: PlatformOperator = {
    isPlatformOperatorEmail: ({ email }) => {
      if (email == null) return false;
      const normalized = email.trim().toLowerCase();
      return config.adminEmails.some((admin) => admin.trim().toLowerCase() === normalized);
    },
  };

  return {
    eventing: identityEventing,
    operators,
    mail: null,
    latch: {
      ttlMs: IDENTITY_LATCH_CACHE_TTL_MS,
      maxUsers: IDENTITY_LATCH_CACHE_MAX_USERS,
      now: Date.now,
    },
    ledger: IdentityLedgerWriterAdapter.create({
      projectionStore: PrismaIdentityProjectionRepository.create({
        prisma,
        reservations: PrismaIdentityReservationRepository.create(prisma),
      }),
      eventing: identityEventing,
    }),
    secrets: PrismaIdentitySecretCarryRepository.create(prisma),
    joinRequestAudience: PrismaJoinRequestAudienceRepository.create(prisma),
    ssoPlatformOperators: AdminEmailPlatformOperatorsRepository.create({
      database: prisma,
      operators,
    }),
    ssoConnectionLedger: ssoConnectionLedger({ prisma, eventing }),
    scimSyncs: PrismaScimSyncProjectionRepository.create(prisma),
  };
}
